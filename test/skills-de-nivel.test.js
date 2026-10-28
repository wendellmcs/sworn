'use strict';
// D678 T4 (plano da escada, par.3 linha 40): o esforco da conversa principal muda por skill, e so o esforco.
// Prova das sondas (2026-10-26-esquadro-pendencias-escada-modelo-pesquisa.md, linha a3): a skill chamada pela
// ferramenta troca o esforco e nao o modelo (run12); digitada, troca os dois (run15). Daqui as tres travas:
// as 2 skills declaram so `effort:` e nao sao comando; o manual as chama pela marcha; e o texto delas avisa que o
// modelo nao muda sozinho, com o comando que muda e a fonte.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const NIVEIS = [
  { skill: 'effort-low', esforco: 'low', marcha: 'Fast' },
  { skill: 'effort-high', esforco: 'high', marcha: 'AAA' }
];

// D700 (e): sem tirar o BOM, um SKILL.md salvo com ele perde o `^---` e o teste acusa frontmatter que existe.
function ler(rel) {
  return fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

function partes(rel) {
  const m = ler(rel).match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, rel + ': o arquivo tem de abrir com o frontmatter entre duas linhas `---`');
  return { frente: m[1], corpo: m[2] };
}

for (const n of NIVEIS) {
  const rel = 'skills/' + n.skill + '/SKILL.md';

  test('skills de nivel: ' + n.skill + ' declara so o esforco ' + n.esforco + ' e nao e comando', () => {
    const { frente } = partes(rel);
    assert.match(frente, new RegExp('^effort: ' + n.esforco + '$', 'm'),
      rel + ': falta `effort: ' + n.esforco + '` no frontmatter (e o esforco que a skill aplica)');
    // Sem `model:`: chamada pela ferramenta o modelo nao muda (run12), e um `model:` que so vale digitado seria
    // promessa que a principal nao cumpre.
    assert.doesNotMatch(frente, /^model:/m, rel + ': tirar o `model:` do frontmatter (skill de nivel nao troca modelo)');
    // Quem chama e a principal, pela marcha; o dono nao digita (a doc: `user-invocable: false` = so o Claude chama).
    assert.match(frente, /^user-invocable: false$/m,
      rel + ': falta `user-invocable: false` no frontmatter (a skill fica fora do menu de comandos)');
    assert.doesNotMatch(frente, /^disable-model-invocation:/m,
      rel + ': tirar o `disable-model-invocation:` do frontmatter (a principal tem de poder chamar a skill)');
    const desc = (frente.match(/^description: (.*)$/m) || [])[1] || '';
    assert.ok(desc.includes(n.marcha), rel + ': a description tem de citar a marcha que chama a skill (' + n.marcha + ')');
  });

  test('skills de nivel: ' + n.skill + ' avisa que o modelo nao muda, com o comando e a fonte', () => {
    const { corpo } = partes(rel);
    assert.match(corpo, /run12/, rel + ': o corpo tem de citar a sonda que mediu so o esforco mudando (run12)');
    assert.match(corpo, /once per conversation/i, rel + ': falta "once per conversation" (o aviso sai uma vez, nao a cada chamada)');
    // D700 (b): depois de compactar o contexto, a principal pode nao ver mais que ja avisou.
    assert.match(corpo, /compacted/, rel + ': falta dizer o que fazer depois de compactar o contexto (avisar de novo)');
    // R1 da D699 (microcopy): a linha que o dono le sai no idioma dele, sem o nome interno da sonda, e diz que
    // trocar o modelo e escolha dele.
    assert.match(corpo, /owner's language/, rel + ': falta mandar o aviso no idioma do dono ("owner\'s language")');
    // D700 (e): o aviso e so o bloco `>` logo depois de "In English:"; outra citacao no corpo nao entra na conta.
    const depois = corpo.split('In English:\n\n')[1];
    assert.ok(depois, rel + ': falta a linha que termina em "In English:", com uma linha em branco antes do aviso');
    const linhas = depois.split('\n');
    const fim = linhas.findIndex(function (l) { return !l.startsWith('>'); });
    const aviso = linhas.slice(0, fim === -1 ? linhas.length : fim).join(' ');
    assert.ok(aviso, rel + ': falta o aviso em citacao (`> ...`) logo depois de "In English:"');
    assert.ok(aviso.includes('`/model`'), rel + ': o aviso tem de dizer o comando que troca o modelo (`/model`)');
    assert.doesNotMatch(aviso, /\brun\d/, rel + ': tirar do aviso o nome interno da sonda (runN); o dono nao o conhece');
    assert.match(aviso, /2\.1\.310/, rel + ': o aviso tem de citar a versao em que o sworn mediu (2.1.310)');
    assert.match(aviso, /\bif you want\b/i, rel + ': o aviso tem de dizer que trocar o modelo e escolha do dono ("if you want")');
  });
}

function passo0(rel) {
  const m = ler(rel).match(/\n## 2\. Step 0[\s\S]*?(?=\n## |$)/);
  assert.ok(m, rel + ': sumiu o cabecalho "## 2. Step 0"; restaurar o cabecalho ou atualizar este teste');
  return m[0];
}

test('skills de nivel: o manual chama cada uma pela marcha no Passo 0, e a Standard fica no esforco da sessao', () => {
  const rel = 'skills/playbook/SKILL.md';
  const s = passo0(rel);
  for (const n of NIVEIS) {
    const linha = s.split('\n').find(function (l) { return l.includes('sworn:' + n.skill); });
    assert.ok(linha, rel + ': o Passo 0 tem de chamar `sworn:' + n.skill + '`');
    assert.ok(linha.includes(n.marcha), rel + ': `sworn:' + n.skill + '` tem de estar na linha da marcha ' + n.marcha);
  }
  assert.match(s, /Standard[^\n]*session effort/, rel + ': a marcha Standard fica no esforco da sessao, sem skill de nivel');
  // D700 (a): a marcha que sobe no meio da tarefa (o mapa vence para cima) chama a skill da marcha nova.
  assert.match(s.replace(/\s+/g, ' '), /gear goes up[^.]*call the skill of the new gear/,
    rel + ': o Passo 0 tem de mandar chamar a skill da marcha nova quando a marcha sobe no meio da tarefa');
  // D702 (1): a Standard nao tem skill, e de Fast para Standard o esforco baixo pode ficar; a principal chama a alta.
  assert.match(s.replace(/\s+/g, ' '), /Fast to Standard[^.]*`sworn:effort-high`/,
    rel + ': o Passo 0 tem de mandar chamar `sworn:effort-high` de Fast para Standard (senao o esforco baixo pode ficar)');
});

// D711 (T7, r5 7d74ba7e): o esforco da skill dura so o resto do turno que a chamou; o turno seguinte, no mesmo
// processo (o caminho do VS Code), volta ao da sessao. Chamada so no Passo 0, a tarefa AAA perde o esforco alto do
// 2o turno em diante. Daqui: o manual a chama no comeco de cada turno, e nenhum texto promete mais que o turno.
test('skills de nivel: o manual chama a skill no comeco de cada turno, e o texto diz que o esforco dura o turno', () => {
  const rel = 'skills/playbook/SKILL.md';
  const s = passo0(rel).replace(/\s+/g, ' ');
  assert.match(s, /start of each turn/, rel + ': o Passo 0 tem de mandar chamar a skill de nivel no comeco de cada turno');
  assert.match(s, /end of the turn/, rel + ': o Passo 0 tem de dizer que o esforco da skill dura ate o fim do turno');
  assert.match(s, /2\.1\.311/, rel + ': o Passo 0 tem de citar a versao em que o sworn mediu a duracao (2.1.311)');
  assert.doesNotMatch(s, /effort of this conversation/,
    rel + ': o esforco da skill nao e o da conversa, e o do turno; tirar "effort of this conversation"');
  for (const n of NIVEIS) {
    const sk = 'skills/' + n.skill + '/SKILL.md';
    const { frente, corpo } = partes(sk);
    const desc = (frente.match(/^description: (.*)$/m) || [])[1] || '';
    assert.doesNotMatch(frente + corpo, /while this skill is active/,
      sk + ': o esforco nao dura "while this skill is active", dura o turno; tirar a frase');
    assert.match(desc, /each turn/, sk + ': a description tem de dizer que a skill e chamada a cada turno');
    assert.match(corpo.replace(/\s+/g, ' '), /end of the turn/, sk + ': o corpo tem de dizer que o esforco dura ate o fim do turno');
  }
});

// D711: os textos para o usuario que dizem quando a skill de nivel e chamada dizem "cada turno", nos 2 idiomas.
// D712 (R3 da D711, correcao): todas as mencoes da marca, nao so a 1a; cada paragrafo, item de lista ou linha de
// tabela entra uma vez.
const SEPARADORES = ['\n\n', '\n- ', '\n|'];
function trechosCom(texto, marca) {
  const trechos = [];
  for (let i = texto.indexOf(marca); i !== -1; i = texto.indexOf(marca, i + 1)) {
    // R1 da D711 (correcao): sem separador antes da marca todos dao -1, e slice(-1) pegava o fim do arquivo.
    const ini = Math.max.apply(null, [0].concat(SEPARADORES.map(function (s) { return texto.lastIndexOf(s, i); })));
    const fins = SEPARADORES.map(function (s) { return texto.indexOf(s, i); }).filter(function (x) { return x !== -1; });
    const t = texto.slice(ini, fins.length ? Math.min.apply(null, fins) : texto.length).replace(/\s+/g, ' ').trim();
    if (!trechos.includes(t)) trechos.push(t);
  }
  return trechos;
}

test('skills de nivel: trechosCom acha todas as mencoes, do 1o paragrafo a linha de tabela', () => {
  assert.deepStrictEqual(trechosCom('a effort-low b\n\nc\n\n| x | effort-low y |\n| effort-low |', 'effort-low'),
    ['a effort-low b', '| x | effort-low y |', '| effort-low |']);
});

// O 3o campo e a frase velha exata de cada texto (o HEAD 24614da): a larga reprovava texto novo certo (D712).
// Toda mencao fica sem a velha e diz "cada turno". Filtrar as que dizem quem chama deixava passar o texto velho com
// outro verbo ("aciona"; conferencia da D712); mencao futura sem "cada turno" reprova e pede atualizar o teste.
for (const [rel, frase, velha] of [['README.md', /each turn/, /calls by gear to set/],
  ['README.pt-BR.md', /cada turno/, /chama pela marcha para/], ['CHANGELOG.md', /cada turno/, /chama no Passo 0:/],
  ['GUIA.md', /cada turno/, /chama sozinho logo depois de classificar/]]) {
  test('skills de nivel: ' + rel + ' diz que a skill de nivel e chamada a cada turno', () => {
    const trechos = trechosCom(ler(rel), 'effort-low');
    assert.ok(trechos.length, rel + ': sumiu o trecho que cita `effort-low`; restaurar ou atualizar este teste');
    for (const t of trechos) {
      const onde = rel + ': no trecho "' + t.slice(0, 70) + '...", ';
      assert.doesNotMatch(t, velha, onde + 'tirar a frase velha "' + velha.source + '": a skill e chamada a cada turno');
      assert.match(t, frase, onde + 'dizer que a skill de nivel e chamada a cada turno (ou atualizar este teste, se ' +
        'a mencao nao fala de quando ela e chamada)');
    }
  });
}
