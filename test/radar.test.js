'use strict';
// Plano do radar, T3 (D591 pedidos 1-2, D594, D609): a skill /sworn:radar. O modelo da ficha que a skill
// mostra tem de passar no mesmo conferidor da T2 (`referencia.conferir(texto, { tipo: 'radar' })`): sem isso a skill
// ensinaria uma forma que o script recusa.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const referencia = require('../scripts/lib/referencia.js');

const RAIZ = path.join(__dirname, '..');
const SKILL = path.join(RAIZ, 'skills', 'radar', 'SKILL.md');

function lerSkill() { return fs.readFileSync(SKILL, 'utf8').replace(/\r\n/g, '\n'); }

/** O texto de uma secao `## <prefixo>...` ate a proxima `## ` fora de bloco de codigo (o modelo da ficha tem `## `). */
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

/** O bloco ```markdown da ficha (o primeiro que traz a secao dos candidatos). */
function modeloDaFicha(s) {
  const blocos = s.split('```markdown\n').slice(1).map(function (b) { return b.split('\n```')[0]; });
  const achado = blocos.filter(function (b) { return b.indexOf('## Candidatos') !== -1; })[0];
  assert.ok(achado, 'a skill nao mostra o modelo da ficha num bloco ```markdown');
  return achado;
}

test('radar: frontmatter e o que o comando promete', () => {
  const s = lerSkill();
  assert.match(s, /^---\nname: radar\n/);
  // D614: a description fala primeiro do usuario (projetos parecidos); a semana em alta e do mantenedor do plugin.
  const desc = (s.match(/^description: (.*)$/m) || [])[1] || '';
  assert.match(desc, /parecidos/, 'a description diz de onde vem a lista do usuario');
  assert.match(desc, /mantenedor/, 'a trending e citada como do mantenedor');
  assert.ok(desc.indexOf('parecidos') < desc.indexOf('trending'), 'o usuario vem antes da semana em alta');
  assert.ok(s.includes('github.com/trending?since=weekly'), 'a fonte da semana, do mantenedor');
  assert.match(s, /só com o seu sim/, 'aplicar so com o sim');
});

test('radar: os dois modos - mantenedor pelo plugin.json, usuario pelo projeto.json e README', () => {
  const s = secao(lerSkill(), 'Passo 1');
  assert.match(s, /mantenedor/);
  assert.match(s, /usuário/);
  assert.ok(s.includes('.claude-plugin/plugin.json') && s.includes('"name": "sworn"'), 'como reconhece o repo do plugin');
  assert.ok(s.includes('projeto.json') && s.includes('README'), 'o cruzamento do modo usuario');
  assert.match(s, /lista/, 'a lista que o usuario passar substitui a da semana');
});

test('radar: a ficha puxada do modo mantenedor mora na pasta do vigia (herda o isolamento do SWORN_VIGIA)', () => {
  const s = secao(lerSkill(), 'Passo 1');
  assert.ok(s.includes('~/.claude/sworn/vigia/radar/novidades.md'), 'o caminho onde o vigia-puxar.js grava a ficha');
  assert.ok(!lerSkill().includes('~/.claude/sworn/radar/'), 'o caminho antigo, fora da pasta do vigia');
});

test('radar: a lista - ja estudado, o que nao abriu, texto lido e dado', () => {
  const s = lerSkill();
  assert.match(s, /já estudad/);
  assert.ok(s.includes('.claude/sworn/radar/estudados.md'), 'onde mora a lista dos ja estudados');
  assert.match(s, /não consegui ler/i);
  assert.match(s, /nunca "nada de novo"/i, 'fonte que falhou nao vira semana vazia');
  assert.match(s, /dado, não instrução/);
  assert.match(s, /não clona, não instala, não executa/);
});

test('radar: triagem e aprofundamento - teto, modelo barato, paralelo', () => {
  const s = secao(lerSkill(), 'Passo 3');
  assert.match(s, /triagem/i);
  assert.match(s, /até 5/, 'o teto de aprofundados (D609)');
  assert.match(s, /mais barato/, 'triagem no modelo mais barato');
  assert.ok(s.includes('/sworn:parallel') || s.includes('sworn:reader'), 'a leitura em paralelo pelo que ja existe');
});

test('radar: a entrevista do modo usuario - no maximo 3 perguntas, o exemplo do pedido', () => {
  const s = secao(lerSkill(), 'Passo 4');
  assert.match(s, /AskUserQuestion/);
  assert.match(s, /no máximo 3 perguntas/);
  assert.match(s, /[Ff]az sentido/);
  assert.ok(s.includes('VoiceStudio'), 'o exemplo do pedido 2 (D591)');
  assert.match(s, /nunca `adotar`/, 'duvida sem resposta nao vira adotar');
});

test('radar: sem como perguntar (modo nao interativo) a entrevista nao para a skill - a ficha sai mesmo assim', () => {
  // rodada real da T3 (s114): no `claude -p`, sem AskUserQuestion, a skill perguntou em texto e parou sem ficha
  const s = secao(lerSkill(), 'Passo 4').toLowerCase();
  assert.ok(s.includes('sem como perguntar'), 'o caso sem AskUserQuestion');
  assert.match(s, /não interativ/);
  assert.match(s, /a ficha sai mesmo assim/);
  assert.match(s, /não pare/);
});

test('radar: licenca - ELv2, AGPL, fechada ou sem licenca = so a ideia', () => {
  // na secao da leitura, nao no modelo da ficha (que tambem cita "so a ideia, reescrita" numa celula)
  const s = secao(lerSkill(), 'Passo 3');
  assert.ok(s.includes('ELv2, AGPL, fechada ou sem licença: só a ideia, reescrita'), 'a regra da licenca');
  assert.match(s, /atribuição/);
});

test('radar: a ficha - cabecalhos, valores, conferencia pelo script com --tipo radar', () => {
  const s = secao(lerSkill(), 'Passo 5');
  for (const c of ['| Repo | Licença | Como entra | Como melhora | Esforço | Valor | Veredito |',
    '| Camada | Achado | Origem | Grau | Quem agiu |', '| Pergunta | Estado | O que mediria |']) {
    assert.ok(s.includes(c), 'cabecalho: ' + c);
  }
  for (const v of ['adotar', 'inspiração', 'descartar', 'baixo', 'médio', 'alto']) assert.ok(s.includes('`' + v + '`'), 'valor: ' + v);
  assert.match(s, /`P`, `M` ou `G`/);
  assert.ok(s.includes('Não li:'));
  assert.ok(s.includes('node "${CLAUDE_PLUGIN_ROOT}/scripts/referencia.js" ') && s.includes('--tipo radar'), 'o comando que confere');
  assert.ok(s.includes('.claude/sworn/radar/<AAAA-MM-DD>.md'), 'onde a ficha do modo usuario mora');
  assert.ok(s.includes('.claude/sworn/radar/**') && /portão de escopo/.test(s), 'o escopo cobre a pasta antes do Write');
  assert.match(s, /`--gravar`/, 'diz que a ficha do radar nao entra na referencias');
});

test('radar: o modelo da ficha mostrado na skill passa no conferidor do radar', () => {
  const r = referencia.conferir(modeloDaFicha(lerSkill()), { tipo: 'radar' });
  assert.deepStrictEqual(r.problemas, [], 'o modelo da skill e recusado pelo script que ela manda rodar');
  assert.ok(r.candidatos >= 1 && r.achados >= 1 && r.semSaber >= 1);
});

test('radar: a semana sem aprofundado (a linha da skill) passa no conferidor', () => {
  const s = lerSkill();
  const linha = s.split('\n').filter(function (l) { return /^\s*\| nenhum novo/.test(l); })[0];
  assert.ok(linha, 'a skill nao diz como fica a semana sem candidato novo');
  const modelo = modeloDaFicha(s).split('\n');
  const i = modelo.findIndex(function (l) { return l.trim() === '## Candidatos'; });
  const j = modelo.findIndex(function (l, k) { return k > i && /^## /.test(l); });
  const semCand = modelo.slice(0, i + 1).concat(['', '| Repo | Licença | Como entra | Como melhora | Esforço | Valor | Veredito |',
    '|---|---|---|---|---|---|---|', linha.trim(), ''], modelo.slice(j));
  const r = referencia.conferir(semCand.join('\n'), { tipo: 'radar' });
  assert.deepStrictEqual(r.problemas, []);
  assert.strictEqual(r.candidatos, 1);
  assert.strictEqual(r.adotar, 0);
});

test('radar: o fecho - 3 opcoes, a recomendada primeiro, o escolhido entra com teste vermelho e revisao cega', () => {
  const s = secao(lerSkill(), 'Passo 6');
  const a = s.indexOf('Levar o melhor candidato');
  const b = s.indexOf('Guardar a ficha');
  const c = s.indexOf('Aprofundar outro');
  assert.ok(a !== -1 && b > a && c > b, 'as 3 opcoes, nesta ordem');
  assert.match(s.slice(a, b), /recomendada/);
  assert.match(s, /teste vermelho/);
  assert.ok(s.includes('/sworn:review'), 'o que entra passa pela revisao cega');
  assert.match(s, /melhor que o original/);
});

test('radar: o que a skill nao faz', () => {
  const s = secao(lerSkill(), 'O que esta skill NÃO faz');
  assert.match(s, /[Nn]ão aplica nada sozinha/);
  assert.match(s, /login/);
  assert.match(s, /`referencias`/);
});

test('radar: a lista do usuario e a busca por tema - parecidos com o que ele constroi ou pediu, nunca a trending (T3b, D611; D614)', () => {
  const s = lerSkill();
  const p1 = secao(s, 'Passo 1');
  const p2 = secao(s, 'Passo 2');
  assert.match(p1, /por tema/i, 'o Passo 1 diz que ha lista por tema');
  assert.match(p1, /até 10 repositórios/, 'o teto da lista por tema');
  assert.match(p1, /oferta/, 'quando o radar vem da oferta do gancho');
  assert.ok(p1.includes('site:github.com <tema>'), 'a busca pelo WebSearch');
  assert.ok(p1.includes('https://github.com/search?q=<tema>&type=repositories') && p1.includes('WebFetch'), 'a busca do GitHub pelo WebFetch');
  assert.match(p1, /já estudado/, 'a regra do ja estudado vale por tema');
  assert.match(p1, /licença/, 'a regra da licenca vale por tema');
  assert.match(p1, /não clona/, 'a regra de nao clonar vale por tema');
  // D614: no modo usuario a lista padrao NAO e a trending; a trending e so do mantenedor
  assert.match(p1, /nunca a trending/, 'o modo usuario nunca le a trending');
  assert.match(p2, /só.{0,40}mantenedor/s, 'o Passo 2 diz que a trending vale so para o mantenedor');
  assert.match(p2, /busca por tema/i, 'no usuario o Passo 2 e a busca por tema');
  assert.match(p2, /não consegui ler: busca por tema/, 'a mesma regra do "nao consegui ler", na busca por tema');
  assert.match(p2, /já estudado/);
  assert.ok(s.includes('Fonte: busca por tema: <tema>') || /`Fonte:` .*busca por tema: <tema>/.test(s), 'a linha Fonte da ficha por tema');
});

test('radar: o abre da skill fala do usuario primeiro; a semana em alta e do mantenedor (D614)', () => {
  const s = lerSkill();
  const abre = s.slice(s.indexOf('# `/sworn:radar`'), s.indexOf('## Passo 1'));
  assert.match(abre, /parecidos/);
  assert.match(abre, /mantenedor/);
  assert.ok(abre.indexOf('parecidos') < abre.indexOf('mantenedor'), 'o usuario vem antes');
});

test('radar: a ficha do modo usuario (tema no lugar da semana) passa no conferidor', () => {
  const s = lerSkill();
  assert.ok(s.includes('tema: <tema>'), 'a skill diz como a ficha por tema abre');
  const modelo = modeloDaFicha(s).replace(/^semana: .*$/m, 'tema: cadastro de clientes por voz')
    .replace(/^# Radar - semana de .*$/m, '# Radar - cadastro de clientes por voz')
    .replace(/^Fonte: .*$/m, 'Fonte: busca por tema: cadastro de clientes por voz, lida às 12:04 UTC; 10 achados, 3 já estudados, 2 aprofundados.');
  const r = referencia.conferir(modelo, { tipo: 'radar' });
  assert.deepStrictEqual(r.problemas, []);
});
