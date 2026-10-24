'use strict';
// A medicao A/B do recurso de qualidade de resposta. O instrumento tem de provar que sabe dar
// CADA um dos 4 vereditos - inclusive os que reprovam o recurso - com resultados de mentira, e
// que nao confunde "o juiz nao respondeu" com "empate". Nada aqui chama o `claude` de verdade:
// o CLI roda como processo contra um `claude` de mentira (um script que emite o stream).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const medicao = require('../scripts/lib/medicao.js');
const qualidade = require('../scripts/lib/qualidade.js');
const veredito = require('../scripts/lib/veredito.js');

const RAIZ = path.join(__dirname, '..');
const CLI = path.join(RAIZ, 'scripts', 'medir-qualidade.js');
const MARCADOR = qualidade.BLOCO.split('\n')[0];

function pasta() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn medicao-')); }

// ── apuracao: fixtures de mentira ────────────────────────────────────────

const IDS = ['p1', 'p2', 'p3', 'p4'];

/** 4 prompts x 3 condicoes, tudo valido; `ajusta(g)` muda uma geracao antes de entrar. */
function geracoes(tokens, ajusta) {
  const t = tokens || { padrao: 100, caveman: 60, recurso: 80 };
  const lista = [];
  IDS.forEach((id) => {
    medicao.CONDICOES.forEach((c) => {
      const g = { prompt: id, condicao: c, ok: true, texto: 'resposta de ' + c, aplicou: true, outputTokens: t[c] };
      if (ajusta) ajusta(g);
      lista.push(g);
    });
  });
  return lista;
}

function vd(melhor, porQue) {
  return { lente: 'clareza', melhor: melhor, porQue: porQue || 'A.txt:3 chega na conclusao antes', achados: [] };
}

/** `quem(id, rival)` diz 'recurso' | 'rival' | 'empate'; as duas ordens saem coerentes com isso. */
function julgamentos(quem) {
  const lista = [];
  IDS.forEach((id) => {
    medicao.RIVAIS.forEach((rival) => {
      const r = quem(id, rival);
      const ordem1 = r === 'recurso' ? 'A' : (r === 'rival' ? 'B' : 'empate');
      const ordem2 = r === 'recurso' ? 'B' : (r === 'rival' ? 'A' : 'empate');
      lista.push({ prompt: id, rival: rival, ordem: 1, veredito: vd(ordem1) });
      lista.push({ prompt: id, rival: rival, ordem: 2, veredito: vd(ordem2) });
    });
  });
  return lista;
}

function apurarCom(g, j) { return medicao.apurar({ prompts: IDS, geracoes: g, julgamentos: j }); }

// ── o juiz e o par ───────────────────────────────────────────────────────

test('medicao/votoDoJuiz: A e B com citacao valem; o resto e empate', () => {
  assert.strictEqual(medicao.votoDoJuiz(vd('A')), 'A');
  assert.strictEqual(medicao.votoDoJuiz(vd('B')), 'B');
  assert.strictEqual(medicao.votoDoJuiz(vd('empate')), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(undefined), 'empate', 'veredito ausente');
  assert.strictEqual(medicao.votoDoJuiz(null), 'empate');
  assert.strictEqual(medicao.votoDoJuiz({ porQue: 'A.txt:3 x' }), 'empate', 'sem melhor');
  assert.strictEqual(medicao.votoDoJuiz(vd('C')), 'empate', 'melhor fora de A/B');
});

test('medicao/votoDoJuiz: voto sem citacao arquivo:linha e empate', () => {
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'porque ficou mais claro')), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt sem numero de linha')), 'empate');
  assert.strictEqual(medicao.votoDoJuiz({ melhor: 'A' }), 'empate', 'sem porQue');
  assert.strictEqual(medicao.votoDoJuiz(vd('B', 'B.txt:12 abre pela conclusao')), 'B');
});

test('medicao/votoDoJuiz: "nao sei" e empate, mesmo com citacao', () => {
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'nao sei, A.txt:1')), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('B', 'B.txt:2 - Nao sei dizer')), 'empate');
  // o juiz escreve em portugues e pode acentuar: "nao sei" com til tambem e empate
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'não sei, A.txt:1')), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('B', 'B.txt:2 - NÃO SEI dizer')), 'empate');
  // controle: "nao" sozinho, sem "sei", segue contando
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 não repete o log')), 'A');
});

test('medicao/votoDoJuiz: "nao sei" citado do texto julgado conta voto; o que abre ou fica fora de aspas e empate', () => {
  // o porQue real da rodada 2 (prompt decisao-3, rival caveman, ordem 1): cita 'nao sei' de B.txt entre aspas
  const real = 'A.txt:5-7 diz a recomendacao, que ela e inferida e o que mudaria a escolha em frases completas, ' +
    "enquanto B.txt:5-26 usa telegrafico sem acento ('nao sei', 'modulo podre') que obriga releitura.";
  assert.strictEqual(medicao.votoDoJuiz(vd('A', real)), 'A');
  assert.strictEqual(medicao.votoDoJuiz(vd('B', 'B.txt:4 repete "nao sei" do texto')), 'B');
  // abrir o porQue com "nao sei" e a forma que o contrato do juiz pede: empate, com ou sem aspas
  assert.strictEqual(medicao.votoDoJuiz(vd('A', '"nao sei" A.txt:1')), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', "'nao sei', A.txt:1")), 'empate');
  // til decomposto (NFD), espaco duplo e espaco duro tambem sao "nao sei"
  const TIL = String.fromCharCode(0x303);
  const DURO = String.fromCharCode(0xa0);
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'na' + TIL + 'o sei, A.txt:1')), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('B', 'B.txt:2 - nao  sei dizer')), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('B', 'B.txt:2 - nao' + DURO + 'sei dizer')), 'empate');
});

test('medicao/votoDoJuiz: a citacao e so A.txt:<n> ou B.txt:<n>', () => {
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'a resposta das 12:30 ficou mais clara')), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'C.txt:3 abre pela conclusao')), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'XA.txt:3 abre pela conclusao')), 'empate');
  // controle: a citacao no meio da frase segue valendo
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'em A.txt:3 abre pela conclusao')), 'A');
});

test('medicao/votoDoJuiz: apostrofo entre letras nao e aspa, e a citacao nao cruza a linha', () => {
  const CURVO = String.fromCharCode(0x2019);
  const ABRE = String.fromCharCode(0x2018);
  // apostrofo de palavra (don't, it's, d'agua) nao abre citacao: o "nao sei" do proprio juiz segue empate
  assert.strictEqual(medicao.votoDoJuiz(vd('A', "A.txt:3 e B.txt:5 (don't know) eu nao sei qual e melhor, it's close")), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', "A.txt:3 fala d'agua e eu nao sei qual e melhor, d'agua de novo")), 'empate');
  // a citacao vale numa linha so: aspa solta numa linha nao pareia com outra linhas depois
  assert.strictEqual(medicao.votoDoJuiz(vd('A', "A.txt:2 usa 'x\neu nao sei se resolve\nB.txt:4 diz y'")), 'empate');
  // controle: citacao com apostrofo dentro, reto ou curvo, segue citacao e conta voto
  assert.strictEqual(medicao.votoDoJuiz(vd('A', "A.txt:2 cita 'don't, nao sei' do texto")), 'A');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:2 cita ' + ABRE + 'don' + CURVO + 't, nao sei' + CURVO + ' do texto')), 'A');
  // controle: citacao numa linha, com o porQue em varias, segue contando voto
  assert.strictEqual(medicao.votoDoJuiz(vd('A', "A.txt:2 cita 'nao sei'\nB.txt:4 repete")), 'A');
});

test('medicao/votoDoJuiz: guillemets sao aspas; espaco de largura zero e hifen suave nao escondem o "nao sei"', () => {
  const ABRE = String.fromCharCode(0xab);
  const FECHA = String.fromCharCode(0xbb);
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 o texto diz ' + ABRE + 'nao sei' + FECHA + ' no fim, mas A e mais claro')), 'A');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 o texto diz ' + ABRE + ' nao sei ' + FECHA + ' no fim')), 'A');
  const ZERO = String.fromCharCode(0x200b);
  const SUAVE = String.fromCharCode(0xad);
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 nao' + ZERO + 'sei qual e melhor')), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 nao' + SUAVE + 'sei qual e melhor')), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 na' + SUAVE + 'o sei qual e melhor')), 'empate');
  // controle: "nao" e "sei" separados por outra palavra seguem contando voto
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 nao repete; sei que e melhor')), 'A');
});

test('medicao/votoDoJuiz: abridor curvo ou angular sem fechador nao custa tempo quadratico', () => {
  [0x2018, 0x201c, 0xab].forEach((codigo) => {
    const t0 = Date.now();
    assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:1 ' + String.fromCharCode(codigo).repeat(100000))), 'A');
    const ms = Date.now() - t0;
    assert.ok(ms < 1000, codigo.toString(16) + ': ' + ms + ' ms em 100000 abridores soltos');
  });
});

test('medicao/votoDoJuiz: marca de direcao e seletor de variante nao escondem o "nao sei"; plural solto nao abre aspa; aspa colada em numero cita', () => {
  const LRM = String.fromCharCode(0x200e);
  const VARIANTE = String.fromCharCode(0xfe0f);
  const ARABE = String.fromCharCode(0x61c);
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 o texto e ambiguo, nao' + LRM + 'sei dizer')), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 o texto e ambiguo, n' + LRM + 'ao sei dizer')), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 nao' + VARIANTE + ' sei dizer')), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 nao' + ARABE + 'sei dizer')), 'empate');
  // apostrofo de plural (users') nao abre citacao: o "nao sei" do juiz depois dele segue empate
  assert.strictEqual(medicao.votoDoJuiz(vd('A', "A.txt:3 e os users' B.txt:4 nao sei se 'x' vale")), 'empate');
  // aspa colada no numero da citacao abre a citacao do texto julgado: conta voto
  assert.strictEqual(medicao.votoDoJuiz(vd('A', "cita A.txt:3'nao sei' no texto")), 'A');
});

test('medicao/resultadoDoPar: so conta quando as duas ordens apontam o mesmo lado', () => {
  // ordem 1: o recurso e o A; ordem 2: o recurso e o B
  assert.strictEqual(medicao.resultadoDoPar('A', 'B'), 'recurso');
  assert.strictEqual(medicao.resultadoDoPar('B', 'A'), 'rival');
  assert.strictEqual(medicao.resultadoDoPar('A', 'A'), 'empate', 'ordens discordantes (vies de posicao)');
  assert.strictEqual(medicao.resultadoDoPar('B', 'B'), 'empate');
  assert.strictEqual(medicao.resultadoDoPar('empate', 'B'), 'empate');
  assert.strictEqual(medicao.resultadoDoPar('A', 'empate'), 'empate');
  assert.strictEqual(medicao.resultadoDoPar('empate', 'empate'), 'empate');
});

test('medicao/LENTE: chave clareza, fora das LENTES da revisao, sem citar as 6 regras', () => {
  assert.strictEqual(medicao.LENTE.chave, 'clareza');
  assert.strictEqual(medicao.LENTE.titulo, 'clareza para quem perguntou');
  [].concat(veredito.LENTES, veredito.LENTES_UI).forEach((l) => {
    const dono = typeof l === 'string' ? l : (l.chave || l.titulo || '');
    assert.notStrictEqual(dono, 'clareza', 'a lente da medicao vive so no script');
  });
  // julgar pelas regras do proprio recurso seria circular
  ['preambulo', 'cortesia', 'conclusao', 'evidencia', 'ferramenta', 'termo tecnico'].forEach((p) => {
    assert.strictEqual(medicao.LENTE.pergunta.toLowerCase().indexOf(p), -1, 'a lente cita a regra "' + p + '"');
  });
});

test('medicao/LENTE: a pergunta e a do desenho, sem acento', () => {
  const doc = path.join(RAIZ, 'docs', 'qualidade-de-resposta.md');
  if (!fs.existsSync(doc)) return;
  const semAcento = (s) => s.normalize('NFD').replace(new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'), '');
  const fonte = semAcento(fs.readFileSync(doc, 'utf8')).replace(/\r/g, '');
  const trecho = medicao.LENTE.pergunta;
  const citado = fonte.split('\n').filter((l) => l.indexOf('> ') === 0).map((l) => l.slice(2)).join(' ');
  assert.notStrictEqual(citado.indexOf(trecho), -1, 'a pergunta do script diverge da do desenho: ' + trecho);
  assert.ok(!/[^\x00-\x7f]/.test(medicao.LENTE.pergunta), 'a pergunta tem de ser ASCII');
});

// ── os 4 vereditos ───────────────────────────────────────────────────────

test('medicao/apurar: GANHA - vence os dois rivais e gasta menos que o padrao', () => {
  const r = apurarCom(geracoes(), julgamentos(() => 'recurso'));
  assert.strictEqual(r.veredito, 'GANHA', JSON.stringify(r.motivos));
  assert.deepStrictEqual(r.faltam, []);
  assert.deepStrictEqual(r.placar.caveman, { vitorias: 4, derrotas: 0, empates: 0 });
  assert.deepStrictEqual(r.placar.padrao, { vitorias: 4, derrotas: 0, empates: 0 });
  assert.deepStrictEqual(r.tokens, { padrao: 400, caveman: 240, recurso: 320 });
});

test('medicao/apurar: NAO GANHA - perde para o caveman', () => {
  const r = apurarCom(geracoes(), julgamentos((id, rival) => (rival === 'caveman' ? 'rival' : 'recurso')));
  assert.strictEqual(r.veredito, 'NAO GANHA', JSON.stringify(r.motivos));
  assert.deepStrictEqual(r.placar.caveman, { vitorias: 0, derrotas: 4, empates: 0 });
  assert.ok(r.motivos.length > 0, 'um NAO GANHA tem de dizer por que');
});

test('medicao/apurar: NAO GANHA - vitorias iguais as derrotas nao bastam', () => {
  const quem = (id, rival) => (rival === 'padrao' ? (id === 'p1' || id === 'p2' ? 'recurso' : 'rival') : 'recurso');
  const r = apurarCom(geracoes(), julgamentos(quem));
  assert.strictEqual(r.veredito, 'NAO GANHA');
  assert.deepStrictEqual(r.placar.padrao, { vitorias: 2, derrotas: 2, empates: 0 });
});

test('medicao/apurar: GANHA exige tokens abaixo do padrao - a mesma vitoria com tokens iguais nao ganha', () => {
  const todosVencem = julgamentos(() => 'recurso');
  assert.strictEqual(apurarCom(geracoes({ padrao: 100, caveman: 60, recurso: 100 }), todosVencem).veredito, 'NAO GANHA');
  assert.strictEqual(apurarCom(geracoes({ padrao: 100, caveman: 60, recurso: 120 }), todosVencem).veredito, 'NAO GANHA');
  assert.strictEqual(apurarCom(geracoes({ padrao: 100, caveman: 60, recurso: 99 }), todosVencem).veredito, 'GANHA');
  // o caveman gastar menos nao e criterio: so o padrao conta
  assert.strictEqual(apurarCom(geracoes({ padrao: 100, caveman: 1, recurso: 99 }), todosVencem).veredito, 'GANHA');
});

test('medicao/apurar: INCONCLUSIVO - mais da metade dos pares contra um rival terminou em empate', () => {
  const quem = (id, rival) => (rival === 'padrao' && id !== 'p1' ? 'empate' : 'recurso');
  const r = apurarCom(geracoes(), julgamentos(quem));
  assert.strictEqual(r.veredito, 'INCONCLUSIVO', JSON.stringify(r.placar));
  assert.strictEqual(r.placar.padrao.empates, 3);
});

test('medicao/apurar: metade exata de empates NAO e inconclusivo (o corte e maior que, nao maior ou igual)', () => {
  const quem = (id, rival) => (rival === 'padrao' && (id === 'p1' || id === 'p2') ? 'empate' : 'recurso');
  const r = apurarCom(geracoes(), julgamentos(quem));
  assert.strictEqual(r.placar.padrao.empates, 2);
  assert.strictEqual(r.veredito, 'GANHA', JSON.stringify(r.motivos));
});

test('medicao/apurar: INVALIDO - geracao que falhou', () => {
  const g = geracoes(null, (x) => { if (x.prompt === 'p2' && x.condicao === 'caveman') x.ok = false; });
  const r = apurarCom(g, julgamentos(() => 'recurso'));
  assert.strictEqual(r.veredito, 'INVALIDO');
  assert.ok(r.motivos.some((m) => m.indexOf('p2') !== -1 && m.indexOf('caveman') !== -1), JSON.stringify(r.motivos));
});

test('medicao/apurar: INVALIDO - geracao vazia', () => {
  ['', '   \n', undefined, null].forEach((vazio) => {
    const g = geracoes(null, (x) => { if (x.prompt === 'p1' && x.condicao === 'recurso') x.texto = vazio; });
    assert.strictEqual(apurarCom(g, julgamentos(() => 'recurso')).veredito, 'INVALIDO', 'texto ' + JSON.stringify(vazio));
  });
});

test('medicao/apurar: INVALIDO - a condicao nao se aplicou (aplicou falso)', () => {
  const g = geracoes(null, (x) => { if (x.prompt === 'p3' && x.condicao === 'padrao') x.aplicou = false; });
  const r = apurarCom(g, julgamentos(() => 'recurso'));
  assert.strictEqual(r.veredito, 'INVALIDO');
  assert.ok(r.motivos.some((m) => m.indexOf('p3') !== -1 && m.indexOf('padrao') !== -1), JSON.stringify(r.motivos));
  // so `true` vale: truthy nao serve
  const g2 = geracoes(null, (x) => { if (x.prompt === 'p3') x.aplicou = 1; });
  assert.strictEqual(apurarCom(g2, julgamentos(() => 'recurso')).veredito, 'INVALIDO');
});

test('medicao/apurar: INVALIDO - output_tokens ausente ou invalido NUNCA vira zero', () => {
  [undefined, null, NaN, Infinity, -1, '12', {}].forEach((ruim) => {
    const g = geracoes(null, (x) => { if (x.prompt === 'p4' && x.condicao === 'recurso') x.outputTokens = ruim; });
    const r = apurarCom(g, julgamentos(() => 'recurso'));
    assert.strictEqual(r.veredito, 'INVALIDO', 'outputTokens ' + String(ruim));
  });
  // sem a chave nenhuma: o campo ausente parece zero, e e exatamente o defeito
  const sem = geracoes(null, (x) => { if (x.prompt === 'p4' && x.condicao === 'recurso') delete x.outputTokens; });
  assert.strictEqual(apurarCom(sem, julgamentos(() => 'recurso')).veredito, 'INVALIDO');
  // zero de verdade e numero valido
  const zero = geracoes({ padrao: 100, caveman: 60, recurso: 0 });
  assert.strictEqual(apurarCom(zero, julgamentos(() => 'recurso')).veredito, 'GANHA');
});

test('medicao/apurar: INVALIDO - falta alguma das geracoes, ou ha geracao repetida', () => {
  const g = geracoes();
  const r = apurarCom(g.slice(1), julgamentos(() => 'recurso'));
  assert.strictEqual(r.veredito, 'INVALIDO');
  assert.ok(r.motivos.some((m) => m.indexOf('p1') !== -1), JSON.stringify(r.motivos));
  const repetida = apurarCom(g.concat([g[0]]), julgamentos(() => 'recurso'));
  assert.strictEqual(repetida.veredito, 'INVALIDO', 'geracao repetida esconde qual vale');
});

test('medicao/apurar: o primeiro da tabela vence - INVALIDO ganha de INCONCLUSIVO', () => {
  const g = geracoes(null, (x) => { if (x.prompt === 'p1' && x.condicao === 'padrao') x.aplicou = false; });
  const r = apurarCom(g, julgamentos(() => 'empate'));
  assert.strictEqual(r.veredito, 'INVALIDO');
  const sem = apurarCom(geracoes(), julgamentos(() => 'empate'));
  assert.strictEqual(sem.veredito, 'INCONCLUSIVO', 'o controle: sem geracao ruim, 100% de empate e inconclusivo');
});

test('medicao/apurar: INCONCLUSIVO vence GANHA/NAO GANHA quando os dois casariam', () => {
  // contra o padrao 3 de 4 empatam; a unica decisao e vitoria - GANHA casaria nas vitorias, mas vem depois
  const quem = (id, rival) => (rival === 'padrao' && id !== 'p1' ? 'empate' : 'recurso');
  assert.strictEqual(apurarCom(geracoes(), julgamentos(quem)).veredito, 'INCONCLUSIVO');
});

// ── o juiz que nao respondeu nunca e empate ──────────────────────────────

test('medicao/apurar: par sem veredito -> veredito null e faltam lista o par; nunca empate', () => {
  const todos = julgamentos(() => 'recurso');
  const sem = todos.filter((j) => !(j.prompt === 'p2' && j.rival === 'caveman' && j.ordem === 2));
  const r = apurarCom(geracoes(), sem);
  assert.strictEqual(r.veredito, null);
  assert.deepStrictEqual(r.faltam, ['p2/caveman/2']);
  assert.strictEqual(r.placar.caveman.empates, 0, 'o par sem veredito entrou como empate');
});

test('medicao/apurar: sem nenhum julgamento faltam os 16 pares, na ordem prompt/rival/ordem', () => {
  const r = apurarCom(geracoes(), []);
  assert.strictEqual(r.veredito, null);
  assert.strictEqual(r.faltam.length, 16);
  assert.strictEqual(r.faltam[0], 'p1/caveman/1');
  assert.strictEqual(r.faltam[1], 'p1/caveman/2');
  assert.strictEqual(r.faltam[2], 'p1/padrao/1');
  assert.strictEqual(r.faltam[15], 'p4/padrao/2');
});

test('medicao/apurar: julgamento com veredito vazio conta como faltando, nao como empate', () => {
  const j = julgamentos(() => 'recurso');
  j[0].veredito = null;
  const r = apurarCom(geracoes(), j);
  assert.strictEqual(r.veredito, null);
  assert.deepStrictEqual(r.faltam, ['p1/caveman/1']);
});

test('medicao/apurar: o placar conta vitoria, derrota e empate por rival', () => {
  const quem = (id, rival) => {
    if (rival === 'caveman') return { p1: 'recurso', p2: 'recurso', p3: 'rival', p4: 'empate' }[id];
    return { p1: 'recurso', p2: 'recurso', p3: 'recurso', p4: 'rival' }[id];
  };
  const r = apurarCom(geracoes(), julgamentos(quem));
  assert.deepStrictEqual(r.placar.caveman, { vitorias: 2, derrotas: 1, empates: 1 });
  assert.deepStrictEqual(r.placar.padrao, { vitorias: 3, derrotas: 1, empates: 0 });
  assert.strictEqual(r.veredito, 'GANHA', JSON.stringify(r.motivos));
});

test('medicao/apurar: voto sem citacao vira empate no placar', () => {
  const j = julgamentos(() => 'recurso');
  j.forEach((x) => { if (x.prompt === 'p1' && x.rival === 'padrao') x.veredito.porQue = 'ficou mais claro'; });
  const r = apurarCom(geracoes(), j);
  assert.deepStrictEqual(r.placar.padrao, { vitorias: 3, derrotas: 0, empates: 1 });
});

test('medicao/apurar: prompts podem vir como objetos com id', () => {
  const r = medicao.apurar({ prompts: IDS.map((id) => ({ id: id })), geracoes: geracoes(), julgamentos: julgamentos(() => 'recurso') });
  assert.strictEqual(r.veredito, 'GANHA');
});

test('medicao/apurar: sem prompts nao ha o que medir (INVALIDO, nunca GANHA vazio)', () => {
  assert.strictEqual(medicao.apurar({ prompts: [], geracoes: [], julgamentos: [] }).veredito, 'INVALIDO');
});

test('medicao: CONDICOES e RIVAIS, na ordem do desenho', () => {
  assert.deepStrictEqual(medicao.CONDICOES, ['padrao', 'caveman', 'recurso']);
  assert.deepStrictEqual(medicao.RIVAIS, ['caveman', 'padrao']);
});

test('medicao/perguntaDaCondicao: so o caveman leva o comando, e o juiz nunca o ve', () => {
  assert.strictEqual(medicao.perguntaDaCondicao('Oi?', 'caveman'), '/caveman Oi?');
  assert.strictEqual(medicao.perguntaDaCondicao('Oi?', 'padrao'), 'Oi?');
  assert.strictEqual(medicao.perguntaDaCondicao('Oi?', 'recurso'), 'Oi?');
});

// ── a leitura de UMA execucao: o stream de mentira ──────────────────────

/** Linhas de um stream de mentira no formato do `claude -p --output-format stream-json --verbose`. */
function stream(o) {
  const p = Object.assign({
    aberturas: 1, bloco: false, caveman: false, saida: 0, tokens: 120, subtype: 'success', erro: false,
    texto: 'A suite passou; falta teste no modulo X.', skillSolta: false
  }, o || {});
  const L = [];
  const abertura = '# sworn - regras deste projeto\n\n1. regra de mentira\n' +
    (p.bloco ? '\n' + qualidade.BLOCO : '');
  L.push({ type: 'system', subtype: 'init', session_id: 's1' });
  for (let i = 0; i < p.aberturas; i++) {
    L.push({ type: 'system', subtype: 'hook_started', hook_event: 'SessionStart', hook_name: 'SessionStart:startup' });
    // o progresso repete o stdout parcial: nao pode contar como uma segunda abertura
    L.push({ type: 'system', subtype: 'hook_progress', hook_event: 'SessionStart', hook_name: 'SessionStart:startup', stdout: abertura });
    L.push({ type: 'system', subtype: 'hook_response', hook_event: 'SessionStart', hook_name: 'SessionStart:startup',
      stdout: abertura, stderr: '', output: abertura, exit_code: p.saida, outcome: p.saida === 0 ? 'success' : 'error' });
  }
  // o hook de OUTRO plugin, que nao e a abertura do sworn
  L.push({ type: 'system', subtype: 'hook_response', hook_event: 'SessionStart', hook_name: 'SessionStart:outro',
    stdout: 'contexto de outro plugin', stderr: '', output: 'contexto de outro plugin', exit_code: 0, outcome: 'success' });
  L.push({ type: 'system', subtype: 'hook_response', hook_event: 'UserPromptSubmit', hook_name: 'UserPromptSubmit:x',
    stdout: '', stderr: 'falhou', output: '', exit_code: 1, outcome: 'error' });
  if (p.caveman || p.skillSolta) {
    L.push({ type: 'assistant', parent_tool_use_id: null, message: { id: 'mc', role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_c', name: 'Skill', input: { skill: 'caveman' } }], usage: { output_tokens: 3 } } });
    L.push({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_c', content: 'ok' }] },
      tool_use_result: { success: true, commandName: 'caveman' } });
  }
  L.push({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', role: 'assistant',
    content: [{ type: 'thinking', thinking: 'pensamento que ninguem ve' }], usage: { output_tokens: 7 } } });
  L.push({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', role: 'assistant',
    content: [{ type: 'text', text: 'Lendo o arquivo.' }, { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a.js' } }],
    usage: { output_tokens: 9 } } });
  L.push({ type: 'assistant', parent_tool_use_id: 'tu_sub', message: { id: 'ms', role: 'assistant',
    content: [{ type: 'text', text: 'TEXTO DO SUBAGENTE' }] } });
  L.push({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm2', role: 'assistant',
    content: [{ type: 'text', text: p.texto }] } });
  const usage = p.tokens === undefined ? { input_tokens: 5 } : { input_tokens: 5, output_tokens: p.tokens, iterations: [{ output_tokens: 1 }] };
  L.push({ type: 'result', subtype: p.subtype, is_error: p.erro, result: 'so a mensagem final', usage: usage });
  return L.map((x) => JSON.stringify(x));
}

function ler(o, condicao, extra) {
  return medicao.lerExecucao(stream(o), Object.assign({ condicao: condicao, marcador: MARCADOR }, extra || {}));
}

test('medicao/lerExecucao: condicao recurso valida - o bloco esta presente', () => {
  const r = ler({ bloco: true }, 'recurso');
  assert.strictEqual(r.ok, true, JSON.stringify(r.motivos));
  assert.strictEqual(r.aplicou, true, JSON.stringify(r.motivos));
  assert.strictEqual(r.outputTokens, 120, 'so o usage do evento result: o parcial do assistant nao conta');
  assert.deepStrictEqual(r.motivos, []);
});

test('medicao/lerExecucao: condicao padrao valida - sem bloco e sem caveman', () => {
  const r = ler({}, 'padrao');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.aplicou, true, JSON.stringify(r.motivos));
});

test('medicao/lerExecucao: condicao caveman valida - a skill ligou, sem bloco', () => {
  const r = ler({ caveman: true }, 'caveman');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.aplicou, true, JSON.stringify(r.motivos));
});

test('medicao/lerExecucao: bloco no padrao -> nao aplicou (o recurso vazou para a condicao de controle)', () => {
  const r = ler({ bloco: true }, 'padrao');
  assert.strictEqual(r.aplicou, false);
  assert.ok(r.motivos.some((m) => /bloco/.test(m)), JSON.stringify(r.motivos));
  assert.strictEqual(ler({ bloco: true, caveman: true }, 'caveman').aplicou, false, 'bloco no caveman tambem contamina');
});

test('medicao/lerExecucao: bloco ausente no recurso -> nao aplicou', () => {
  const r = ler({ bloco: false }, 'recurso');
  assert.strictEqual(r.aplicou, false);
  assert.ok(r.motivos.some((m) => /bloco/.test(m)), JSON.stringify(r.motivos));
});

test('medicao/lerExecucao: caveman no recurso ou no padrao -> nao aplicou', () => {
  const noRecurso = ler({ bloco: true, caveman: true }, 'recurso');
  assert.strictEqual(noRecurso.aplicou, false);
  assert.ok(noRecurso.motivos.some((m) => /caveman/.test(m)), JSON.stringify(noRecurso.motivos));
  assert.strictEqual(ler({ caveman: true }, 'padrao').aplicou, false);
  // a skill acionada sem ser a condicao (chamada solta) contamina do mesmo jeito
  assert.strictEqual(ler({ bloco: true, skillSolta: true }, 'recurso').aplicou, false);
});

test('medicao/lerExecucao: caveman ausente na condicao caveman -> nao aplicou', () => {
  const r = ler({ caveman: false }, 'caveman');
  assert.strictEqual(r.aplicou, false);
  assert.ok(r.motivos.some((m) => /caveman/.test(m)), JSON.stringify(r.motivos));
});

test('medicao/lerExecucao: caveman que nao deu sucesso nao liga a condicao', () => {
  const linhas = stream({ caveman: true }).map((l) => l.replace('"success":true,"commandName":"caveman"', '"success":false,"commandName":"caveman"'));
  const r = medicao.lerExecucao(linhas, { condicao: 'caveman', marcador: MARCADOR });
  assert.strictEqual(r.aplicou, false);
});

test('medicao/lerExecucao: sem a abertura do sworn, ou com ela duas vezes -> nao aplicou', () => {
  const nenhuma = ler({ aberturas: 0 }, 'padrao');
  assert.strictEqual(nenhuma.aplicou, false, 'sem a abertura, a ausencia do bloco no padrao nao provaria nada');
  assert.ok(nenhuma.motivos.some((m) => /abertura/.test(m)), JSON.stringify(nenhuma.motivos));
  const dupla = ler({ aberturas: 2, bloco: true }, 'recurso');
  assert.strictEqual(dupla.aplicou, false, 'plugin carregado duas vezes');
  assert.ok(dupla.motivos.some((m) => /abertura/.test(m)), JSON.stringify(dupla.motivos));
});

test('medicao/lerExecucao: SessionStart com exit_code diferente de 0 -> nao aplicou', () => {
  const r = ler({ saida: 1 }, 'padrao');
  assert.strictEqual(r.aplicou, false);
  assert.ok(r.motivos.some((m) => /SessionStart/.test(m)), JSON.stringify(r.motivos));
});

test('medicao/lerExecucao: so o SessionStart conta - o hook de outro evento que falhou nao invalida', () => {
  // o stream de mentira ja leva um UserPromptSubmit com exit_code 1
  assert.strictEqual(ler({}, 'padrao').aplicou, true);
});

test('medicao/lerExecucao: SessionStart sem exit_code nao vale como exit 0', () => {
  const linhas = stream({}).map((l) => {
    const o = JSON.parse(l);
    if (o.subtype === 'hook_response' && o.hook_event === 'SessionStart') delete o.exit_code;
    return JSON.stringify(o);
  });
  assert.strictEqual(medicao.lerExecucao(linhas, { condicao: 'padrao', marcador: MARCADOR }).aplicou, false);
});

test('medicao/lerExecucao: output_tokens ausente -> outputTokens nao e numero, ok falso, e apurar da INVALIDO', () => {
  const r = ler({ tokens: undefined }, 'padrao');
  assert.notStrictEqual(typeof r.outputTokens, 'number', 'campo ausente virou numero: ' + r.outputTokens);
  assert.strictEqual(r.ok, false);
  const g = geracoes(null, (x) => { if (x.prompt === 'p1' && x.condicao === 'padrao') Object.assign(x, { texto: r.texto, outputTokens: r.outputTokens, ok: true, aplicou: true }); });
  assert.strictEqual(apurarCom(g, julgamentos(() => 'recurso')).veredito, 'INVALIDO');
});

test('medicao/lerExecucao: sem evento result, ou result com erro -> ok falso', () => {
  const semResult = stream({}).filter((l) => JSON.parse(l).type !== 'result');
  const a = medicao.lerExecucao(semResult, { condicao: 'padrao', marcador: MARCADOR });
  assert.strictEqual(a.ok, false);
  assert.notStrictEqual(typeof a.outputTokens, 'number');
  assert.strictEqual(ler({ erro: true }, 'padrao').ok, false, 'is_error');
  assert.strictEqual(ler({ subtype: 'error_max_turns' }, 'padrao').ok, false, 'subtype diferente de success');
});

test('medicao/lerExecucao: texto visivel = so os blocos text sem pai; subagente e pensamento ficam fora', () => {
  const r = ler({}, 'padrao');
  assert.ok(r.texto.indexOf('Lendo o arquivo.') !== -1, 'a atualizacao entre ferramentas e vista pelo usuario');
  assert.ok(r.texto.indexOf('A suite passou; falta teste no modulo X.') !== -1);
  assert.strictEqual(r.texto.indexOf('SUBAGENTE'), -1, 'texto de subagente nao e visto pelo usuario');
  assert.strictEqual(r.texto.indexOf('pensamento'), -1);
  assert.strictEqual(r.texto.indexOf('so a mensagem final'), -1, 'o result.result perde as atualizacoes: nao serve');
  assert.ok(r.texto.indexOf('Lendo o arquivo.') < r.texto.indexOf('A suite passou'), 'ordem do stream');
});

test('medicao/lerExecucao: linha que nao e JSON e ignorada; aceita texto unico com quebras', () => {
  const linhas = stream({ bloco: true });
  const comLixo = ['', 'isto nao e json', '{quebrado'].concat(linhas);
  assert.strictEqual(medicao.lerExecucao(comLixo, { condicao: 'recurso', marcador: MARCADOR }).aplicou, true);
  assert.strictEqual(medicao.lerExecucao(linhas.join('\r\n'), { condicao: 'recurso', marcador: MARCADOR }).aplicou, true);
});

test('medicao/lerExecucao: stream vazio nao aplica nada e nao tem tokens', () => {
  const r = medicao.lerExecucao([], { condicao: 'padrao', marcador: MARCADOR });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.aplicou, false);
  assert.notStrictEqual(typeof r.outputTokens, 'number');
});

// ── os prompts congelados ───────────────────────────────────────────────

const PROMPTS = JSON.parse(fs.readFileSync(path.join(RAIZ, 'modelos', 'qualidade-prompts.json'), 'utf8'));

test('prompts: 12, 3 de cada tipo, 2 em ingles, ids unicos e ASCII', () => {
  assert.strictEqual(PROMPTS.versao, 1);
  assert.strictEqual(PROMPTS.prompts.length, 12);
  ['explicar', 'diagnosticar', 'ferramentas', 'decisao'].forEach((t) => {
    assert.strictEqual(PROMPTS.prompts.filter((p) => p.tipo === t).length, 3, 'tipo ' + t);
  });
  assert.strictEqual(PROMPTS.prompts.filter((p) => p.idioma === 'en').length, 2);
  PROMPTS.prompts.forEach((p) => assert.ok(p.idioma === 'pt' || p.idioma === 'en', p.id + ' idioma ' + p.idioma));
  assert.strictEqual(new Set(PROMPTS.prompts.map((p) => p.id)).size, 12, 'id repetido');
  PROMPTS.prompts.forEach((p) => {
    assert.ok(/^[a-z0-9-]+$/.test(p.id), 'id fora de ASCII simples: ' + p.id);
    assert.ok(typeof p.texto === 'string' && p.texto.trim().length > 20, p.id + ' sem pergunta');
  });
});

test('prompts: so os de ferramentas trazem arquivos, com caminho relativo e conteudo', () => {
  assert.strictEqual(PROMPTS.prompts.length, 12, 'lista vazia passaria sem conferir nada');
  PROMPTS.prompts.forEach((p) => {
    const arqs = p.arquivos || {};
    if (p.tipo !== 'ferramentas') {
      assert.strictEqual(Object.keys(arqs).length, 0, p.id + ' nao e de ferramentas e traz arquivos');
      return;
    }
    assert.ok(Object.keys(arqs).length > 0, p.id + ' precisa dos arquivos do brinquedo');
    Object.keys(arqs).forEach((k) => {
      assert.ok(!path.isAbsolute(k) && k.split('/').indexOf('..') === -1 && k.indexOf('\\') === -1, 'caminho ruim: ' + k);
      assert.ok(typeof arqs[k] === 'string' && arqs[k].length > 0, k + ' vazio');
    });
  });
});

test('prompts: ASCII puro, LF, sem nome de modelo e sem codigo de registro', () => {
  const bruto = fs.readFileSync(path.join(RAIZ, 'modelos', 'qualidade-prompts.json'), 'utf8');
  assert.ok(!/\r/.test(bruto), 'CR no arquivo');
  assert.ok(!/[^\x00-\x7f]/.test(bruto), 'caractere fora de ASCII');
  assert.ok(!/sonnet|opus|haiku|claude-/i.test(bruto), 'nome de modelo nos prompts');
  assert.ok(!/(?<!%)\b(?:[A-F]\d{1,2}|D\d{1,3}|R\d{1,2})\b/.test(bruto), 'codigo de registro nos prompts');
});

test('prompts: nenhuma dependencia de rede nem de Bash', () => {
  assert.strictEqual(PROMPTS.prompts.length, 12, 'lista vazia passaria sem conferir nada');
  PROMPTS.prompts.forEach((p) => {
    const tudo = p.texto + JSON.stringify(p.arquivos || {});
    assert.ok(!/https?:\/\//i.test(p.texto), p.id + ' pede rede');
    assert.ok(!/\b(?:npm test|npm run|node [a-z]|bash|execute|rode o|run the tests?)\b/i.test(p.texto), p.id + ' pede para executar comando: ' + tudo.slice(0, 60));
  });
});

// ── o CLI, como processo, contra um `claude` de mentira ─────────────────

const FAKE = [
  "'use strict';",
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "const qualidade = require(%QUALIDADE%);",
  "const entrada = fs.readFileSync(0, 'utf8');",
  "if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args: process.argv.slice(2), entrada: entrada, cwd: process.cwd() }) + '\\n');",
  "let projeto = {};",
  "try { projeto = JSON.parse(fs.readFileSync('.claude/sworn/projeto.json', 'utf8')); } catch (e) { projeto = {}; }",
  "const caveman = entrada.indexOf('/caveman ') === 0;",
  "const bloco = projeto.qualidadeDeResposta !== false;",
  "const abertura = '# sworn - regras deste projeto\\n\\n1. regra\\n' + (bloco ? '\\n' + qualidade.BLOCO : '');",
  "const out = [];",
  "out.push({ type: 'system', subtype: 'hook_response', hook_event: 'SessionStart', hook_name: 'SessionStart:startup', stdout: abertura, stderr: '', output: abertura, exit_code: 0, outcome: 'success' });",
  "const sid = 'sessao-' + process.pid + '-' + Date.now();",
  "out.unshift({ type: 'system', subtype: 'init', session_id: sid });",
  "if (process.env.CLAUDE_CONFIG_DIR && process.env.FAKE_SEM_TRANSCRICAO !== '1') {",
  "  fs.mkdirSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'outra-pasta'), { recursive: true });",
  "  const sub = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'pasta-qualquer');",
  "  fs.mkdirSync(sub, { recursive: true });",
  "  const conteudo = caveman ? '<command-message>caveman</command-message>\\n<command-name>/caveman</command-name>\\n<command-args>x</command-args>' : entrada;",
  "  fs.writeFileSync(path.join(sub, sid + '.jsonl'), JSON.stringify({ type: 'user', message: { role: 'user', content: conteudo } }) + '\\n');",
  "}",
  "const texto = 'resposta ' + (caveman ? 'caveman' : (bloco ? 'recurso' : 'padrao'));",
  "out.push({ type: 'assistant', parent_tool_use_id: null, message: { id: 'b', content: [{ type: 'text', text: texto }] } });",
  "if (process.env.FAKE_SEM_RESULT !== '1') out.push({ type: 'result', subtype: 'success', is_error: false, result: texto, usage: { output_tokens: caveman ? 10 : (bloco ? 20 : 30) } });",
  "process.stdout.write(out.map((o) => JSON.stringify(o)).join('\\n') + '\\n');"
].join('\n');

function ambienteFalso() {
  const dir = pasta();
  const fake = path.join(dir, 'claude falso.js');
  fs.writeFileSync(fake, FAKE.replace('%QUALIDADE%', JSON.stringify(path.join(RAIZ, 'scripts', 'lib', 'qualidade.js'))), 'utf8');
  return { dir: dir, fake: fake, log: path.join(dir, 'chamadas.log'), onde: path.join(dir, 'onde roda'), config: path.join(dir, 'config') };
}

function cli(args, o) {
  const opcoes = o || {};
  const env = Object.assign({}, process.env, opcoes.env || {});
  fs.mkdirSync(opcoes.cwd || os.tmpdir(), { recursive: true });
  return spawnSync(process.execPath, [CLI].concat(args), { cwd: opcoes.cwd || os.tmpdir(), encoding: 'utf8', env: env, timeout: 120000 });
}

function achar(dir, nome) {
  // a unica pasta de rodada dentro de medicao-qr
  const base = path.join(dir, '.claude', 'sworn', 'medicao-qr');
  const rodadas = fs.readdirSync(base);
  assert.strictEqual(rodadas.length, 1, 'esperava 1 rodada em ' + base + ': ' + rodadas);
  return path.join(base, rodadas[0]);
}

test('cli: --gerar sem --modelo recusa com a forma de uso, sai diferente de 0 e nao roda o claude', () => {
  const a = ambienteFalso();
  const r = cli(['--gerar', '--destino', path.join(a.dir, 'brinquedos')], { cwd: a.onde, env: { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config } });
  assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(/--modelo/.test(r.stdout + r.stderr), 'a recusa tem de mostrar a forma de uso: ' + r.stdout + r.stderr);
  assert.ok(!fs.existsSync(a.log), 'o claude rodou sem modelo');
  assert.ok(!fs.existsSync(path.join(a.dir, 'brinquedos')), 'criou pasta sem modelo');
  const vazio = cli(['--gerar', '--modelo', '', '--destino', path.join(a.dir, 'brinquedos')], { cwd: a.onde, env: { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config } });
  assert.notStrictEqual(vazio.status, 0, 'modelo vazio tambem recusa');
  assert.ok(!fs.existsSync(a.log));
});

test('cli: --gerar sem --destino recusa', () => {
  const a = ambienteFalso();
  const r = cli(['--gerar', '--modelo', 'modelo-x'], { cwd: a.onde, env: { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config } });
  assert.notStrictEqual(r.status, 0);
  assert.ok(/--destino/.test(r.stdout + r.stderr));
  assert.ok(!fs.existsSync(a.log));
});

test('cli: sem modo nenhum imprime o uso e sai diferente de 0', () => {
  const r = cli([], { cwd: pasta() });
  assert.notStrictEqual(r.status, 0);
  assert.ok(/--gerar/.test(r.stdout + r.stderr) && /--pares/.test(r.stdout + r.stderr) && /--veredito/.test(r.stdout + r.stderr));
});

test('cli: --gerar monta o brinquedo de cada condicao, chama o claude e grava geracoes.json', () => {
  const a = ambienteFalso();
  const destino = path.join(a.dir, 'brinquedos');
  const r = cli(['--gerar', '--modelo', 'modelo-x', '--destino', destino, '--prompt', 'ferramentas-1'],
    { cwd: a.onde, env: { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config } });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);

  const rodada = achar(a.onde);
  const ger = JSON.parse(fs.readFileSync(path.join(rodada, 'geracoes.json'), 'utf8'));
  assert.strictEqual(ger.geracoes.length, 3);
  assert.deepStrictEqual(ger.geracoes.map((g) => g.condicao), ['padrao', 'caveman', 'recurso']);
  ger.geracoes.forEach((g) => {
    assert.strictEqual(g.ok, true, JSON.stringify(g));
    assert.strictEqual(g.aplicou, true, JSON.stringify(g));
    assert.strictEqual(g.prompt, 'ferramentas-1');
  });
  assert.deepStrictEqual(ger.geracoes.map((g) => g.outputTokens), [30, 10, 20]);
  assert.deepStrictEqual(ger.geracoes.map((g) => g.texto), ['resposta padrao', 'resposta caveman', 'resposta recurso']);
  assert.strictEqual(ger.modelo, 'modelo-x');
  assert.deepStrictEqual(ger.prompts.map((p) => p.id), ['ferramentas-1']);
  assert.ok(ger.prompts[0].texto.length > 20, 'a pergunta fica na rodada: --pares nao pode depender do arquivo de prompts');
  // a transcricao da sessao, copiada: e a prova do caveman, e o stream nao a traz
  ['padrao', 'caveman', 'recurso'].forEach((c) => {
    const t = path.join(rodada, 'ferramentas-1-' + c + '.transcricao.jsonl');
    assert.ok(fs.existsSync(t), 'sem a transcricao de ' + c);
    assert.strictEqual(fs.readFileSync(t, 'utf8').indexOf('<command-name>/caveman</command-name>') !== -1, c === 'caveman', c);
  });
  // o stream bruto de cada execucao fica ao lado
  ['padrao', 'caveman', 'recurso'].forEach((c) => {
    assert.ok(fs.existsSync(path.join(rodada, 'ferramentas-1-' + c + '.stream.jsonl')), 'sem o stream bruto de ' + c);
  });

  // o brinquedo de cada condicao: pasta nova, git init, projeto.json, regras e os arquivos do prompt
  const carimbo = fs.readdirSync(destino);
  assert.strictEqual(carimbo.length, 1);
  const brinq = (c) => path.join(destino, carimbo[0], 'ferramentas-1-' + c);
  ['padrao', 'caveman', 'recurso'].forEach((c) => {
    assert.ok(fs.existsSync(path.join(brinq(c), '.git')), c + ': sem git init');
    assert.ok(fs.existsSync(path.join(brinq(c), '.claude', 'sworn', 'regras.md')), c + ': sem regras.md');
    const pj = JSON.parse(fs.readFileSync(path.join(brinq(c), '.claude', 'sworn', 'projeto.json'), 'utf8'));
    if (c === 'recurso') assert.ok(!('qualidadeDeResposta' in pj), 'o recurso nao pode gravar a chave');
    else assert.strictEqual(pj.qualidadeDeResposta, false, c);
    PROMPTS.prompts.filter((p) => p.id === 'ferramentas-1').forEach((p) => {
      Object.keys(p.arquivos).forEach((k) => assert.ok(fs.existsSync(path.join(brinq(c), k)), c + ': falta ' + k));
    });
  });

  // a chamada: stdin com a pergunta; o caveman com o comando; plugin-dir com espaco num argumento so
  const chamadas = fs.readFileSync(a.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(chamadas.length, 3);
  const pergunta = ger.prompts[0].texto;
  assert.strictEqual(chamadas[0].entrada, pergunta);
  assert.strictEqual(chamadas[1].entrada, '/caveman ' + pergunta);
  assert.strictEqual(chamadas[2].entrada, pergunta);
  chamadas.forEach((c, i) => {
    const args = c.args;
    assert.ok(args.indexOf('-p') !== -1 && args.indexOf('--verbose') !== -1);
    assert.strictEqual(args[args.indexOf('--output-format') + 1], 'stream-json');
    assert.strictEqual(args[args.indexOf('--model') + 1], 'modelo-x');
    assert.strictEqual(args[args.indexOf('--permission-mode') + 1], 'acceptEdits');
    assert.strictEqual(args[args.indexOf('--plugin-dir') + 1], RAIZ, 'o plugin e o de trabalho, num argumento so');
    assert.strictEqual(fs.realpathSync.native(c.cwd), fs.realpathSync.native(brinq(['padrao', 'caveman', 'recurso'][i])), 'o claude roda no brinquedo');
    // caminho em forma curta (8.3) faz o claude negar Read e Glob: o cwd tem de chegar expandido
    assert.strictEqual(c.cwd, fs.realpathSync.native(c.cwd), 'o cwd do claude esta em forma curta: ' + c.cwd);
  });
});

test('cli: --gerar nunca apaga nem reaproveita pasta - destino com a pasta da execucao ja existente recusa', () => {
  const a = ambienteFalso();
  const destino = path.join(a.dir, 'brinquedos');
  const ok = cli(['--gerar', '--modelo', 'modelo-x', '--destino', destino, '--prompt', 'explicar-1'], { cwd: a.onde, env: { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config } });
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  const carimbo = fs.readdirSync(destino)[0];
  fs.writeFileSync(path.join(destino, carimbo, 'explicar-1-padrao', 'meu.txt'), 'nao apague', 'utf8');
  // outra rodada, outro carimbo: a pasta antiga segue intacta
  const outra = cli(['--gerar', '--modelo', 'modelo-x', '--destino', destino, '--prompt', 'explicar-1'], { cwd: path.join(a.dir, 'outro lugar'), env: { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config } });
  assert.strictEqual(outra.status, 0, outra.stdout + outra.stderr);
  assert.strictEqual(fs.readFileSync(path.join(destino, carimbo, 'explicar-1-padrao', 'meu.txt'), 'utf8'), 'nao apague');
});

test('cli: --gerar para na primeira execucao que falhou, e grava o que ja havia', () => {
  const a = ambienteFalso();
  const destino = path.join(a.dir, 'brinquedos');
  const r = cli(['--gerar', '--modelo', 'modelo-x', '--destino', destino, '--prompt', 'explicar-1'],
    { cwd: a.onde, env: { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config, FAKE_SEM_RESULT: '1' } });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  const ger = JSON.parse(fs.readFileSync(path.join(achar(a.onde), 'geracoes.json'), 'utf8'));
  assert.strictEqual(ger.geracoes.length, 1, 'continuou gastando depois da falha');
  assert.strictEqual(ger.geracoes[0].ok, false);
  assert.strictEqual(ger.completo, false);
  assert.strictEqual(fs.readFileSync(a.log, 'utf8').trim().split('\n').length, 1);
});

test('cli: --gerar que nao grava a evidencia de uma execucao paga guarda a geracao no geracoes.json, diz o motivo e para', () => {
  // a execucao ja foi paga: o disco que recusa o stream ou a copia da transcricao nao pode levar junto o que se sabe dela
  const casos = [
    ['o stream bruto', 'writeFileSync', 0, '.stream.jsonl', /stream/],
    ['a copia da transcricao', 'copyFileSync', 1, '.transcricao.jsonl', /transcricao/]
  ];
  casos.forEach(([nome, funcao, arg, sufixo, motivo]) => {
    const a = ambienteFalso();
    const env = Object.assign(preloadDeFalha([
      'const original = fs.' + funcao + ';',
      'fs.' + funcao + ' = function () {',
      '  if (String(arguments[' + arg + "]).endsWith('" + sufixo + "')) { const e = new Error('disco cheio de mentira'); e.code = 'ENOSPC'; throw e; }",
      '  return original.apply(this, arguments);',
      '};'
    ]), { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config });
    const r = cli(['--gerar', '--modelo', 'modelo-x', '--destino', path.join(a.dir, 'brinquedos'), '--prompt', 'explicar-1'],
      { cwd: a.onde, env: env });
    assert.strictEqual(r.status, 1, nome + ': ' + r.stdout + r.stderr);
    assert.strictEqual(fs.readFileSync(a.log, 'utf8').trim().split('\n').length, 1, nome + ': continuou gastando');
    const ger = JSON.parse(fs.readFileSync(path.join(achar(a.onde), 'geracoes.json'), 'utf8'));
    assert.strictEqual(ger.geracoes.length, 1, nome + ': a execucao paga sumiu do geracoes.json');
    const g = ger.geracoes[0];
    assert.strictEqual(g.texto, 'resposta padrao', nome);
    assert.strictEqual(g.outputTokens, 30, nome);
    assert.strictEqual(g.ok, false, nome + ': geracao sem a evidencia gravada nao vale');
    assert.ok(g.motivos.some((m) => motivo.test(m) && /ENOSPC/.test(m)), nome + ': o motivo nao diz o que nao gravou: ' + JSON.stringify(g.motivos));
    assert.strictEqual(ger.completo, false, nome);
    assert.ok(/PAROU/.test(r.stderr), nome + ': ' + r.stderr);
  });
});

test('cli: --gerar cujo geracoes.json nao grava depois da execucao paga poe a geracao na mensagem de erro', () => {
  const a = ambienteFalso();
  const env = Object.assign(preloadDeFalha([
    'const original = fs.writeFileSync;',
    'let n = 0;',
    'fs.writeFileSync = function (alvo) {',
    // a 1a gravacao e a de antes de tudo; a 2a, a da 1a execucao paga
    "  if (path.basename(String(alvo)) === 'geracoes.json' && ++n === 2) { const e = new Error('disco cheio de mentira'); e.code = 'ENOSPC'; throw e; }",
    '  return original.apply(this, arguments);',
    '};'
  ]), { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config });
  const r = cli(['--gerar', '--modelo', 'modelo-x', '--destino', path.join(a.dir, 'brinquedos'), '--prompt', 'explicar-1'],
    { cwd: a.onde, env: env });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.strictEqual(fs.readFileSync(a.log, 'utf8').trim().split('\n').length, 1, 'continuou gastando');
  assert.ok(/ENOSPC/.test(r.stderr) && /geracoes\.json/.test(r.stderr), 'nao diz o que nao gravou: ' + r.stderr);
  assert.ok(r.stderr.indexOf('explicar-1-padrao') !== -1, 'nao diz qual execucao: ' + r.stderr);
  assert.ok(r.stderr.indexOf('resposta padrao') !== -1 && r.stderr.indexOf('"outputTokens":30') !== -1, 'a geracao paga se perdeu: ' + r.stderr);
});

test('cli: --gerar cujo claude foi parado pelo limite de tempo ou de saida nao diz que ele nao rodou', () => {
  const casos = [
    ['limite de tempo', 'ETIMEDOUT', /parado/],
    ['limite de saida', 'ENOBUFS', /parado/],
    // controle: o claude que nem comecou segue "nao rodou"
    ['nao comecou', 'ENOENT', /nao rodou/]
  ];
  casos.forEach(([nome, code, motivo]) => {
    const a = ambienteFalso();
    const env = Object.assign(preloadDeFalha([
      "const cp = require('child_process');",
      'const original = cp.spawnSync;',
      'cp.spawnSync = function (cmd, args) {',
      "  if (!Array.isArray(args) || args.indexOf('-p') === -1) return original.apply(this, arguments);",
      "  const r = original.apply(this, arguments);",
      "  const e = new Error('spawnSync " + code + "'); e.code = '" + code + "';",
      "  r.error = e; r.status = null;" + (code === 'ENOENT' ? ' r.pid = 0;' : ''),
      '  return r;',
      '};'
    ]), { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config });
    const r = cli(['--gerar', '--modelo', 'modelo-x', '--destino', path.join(a.dir, 'brinquedos'), '--prompt', 'explicar-1'],
      { cwd: a.onde, env: env });
    assert.strictEqual(r.status, 1, nome + ': ' + r.stdout + r.stderr);
    const g = JSON.parse(fs.readFileSync(path.join(achar(a.onde), 'geracoes.json'), 'utf8')).geracoes[0];
    assert.strictEqual(g.ok, false, nome);
    assert.ok(g.motivos.some((m) => motivo.test(m) && m.indexOf(code) !== -1), nome + ': ' + JSON.stringify(g.motivos));
    if (code !== 'ENOENT') assert.ok(!g.motivos.some((m) => /nao rodou/.test(m)), nome + ': diz que nao rodou: ' + JSON.stringify(g.motivos));
  });
});

test('cli: --gerar com SWORN_CLAUDE relativo o acha a partir de onde roda, e nao do brinquedo', () => {
  const a = ambienteFalso();
  const r = cli(['--gerar', '--modelo', 'modelo-x', '--destino', path.join(a.dir, 'brinquedos'), '--prompt', 'explicar-1'],
    { cwd: a.dir, env: { SWORN_CLAUDE: path.basename(a.fake), FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config } });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(fs.readFileSync(a.log, 'utf8').trim().split('\n').length, 3);
});

test('cli: --gerar com SWORN_CLAUDE que nao serve diz a variavel e o caminho, nao o PATH', () => {
  const a = ambienteFalso();
  const mudo = path.join(a.dir, 'mudo.cmd');
  fs.writeFileSync(mudo, '@echo off', 'utf8');
  const casos = [
    ['arquivo que nao existe', path.join(a.dir, 'sumido.js'), /nao existe/],
    ['atalho que nao diz o que chama', mudo, /atalho/]
  ];
  casos.forEach(([nome, valor, motivo]) => {
    const destino = path.join(a.dir, 'brinquedos');
    const r = cli(['--gerar', '--modelo', 'modelo-x', '--destino', destino], { cwd: a.onde, env: { SWORN_CLAUDE: valor } });
    assert.notStrictEqual(r.status, 0, nome);
    assert.ok(r.stderr.indexOf('SWORN_CLAUDE') !== -1 && r.stderr.indexOf(valor) !== -1, nome + ': nao diz a variavel e o caminho: ' + r.stderr);
    assert.ok(motivo.test(r.stderr), nome + ': ' + r.stderr);
    assert.ok(!/no PATH/.test(r.stderr), nome + ': fala do PATH, que nao foi olhado: ' + r.stderr);
    assert.ok(!fs.existsSync(destino), nome);
  });
});

test('cli: --gerar com claude inexistente falha antes de criar qualquer pasta', () => {
  const a = ambienteFalso();
  const destino = path.join(a.dir, 'brinquedos');
  const r = cli(['--gerar', '--modelo', 'modelo-x', '--destino', destino],
    { cwd: a.onde, env: { SWORN_CLAUDE: path.join(a.dir, 'nao existe.js') } });
  assert.notStrictEqual(r.status, 0);
  assert.ok(/claude/.test(r.stdout + r.stderr));
  assert.ok(!fs.existsSync(destino));
});

test('cli: --gerar com prompt que nao existe recusa', () => {
  const a = ambienteFalso();
  const r = cli(['--gerar', '--modelo', 'modelo-x', '--destino', path.join(a.dir, 'b'), '--prompt', 'nao-existe'],
    { cwd: a.onde, env: { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config } });
  assert.notStrictEqual(r.status, 0);
  assert.ok(!fs.existsSync(a.log));
});

test('cli: --gerar confere os prompts antes de rodar o claude ou criar pasta - id que sobe de pasta, repetido ou pergunta vazia', () => {
  // o arquivo de prompts e o do plugin: a copia do plugin numa pasta temporaria e que recebe o prompt ruim
  const fuga = 'fuga-' + process.pid + '-' + Date.now();
  const casos = [
    ['id que sobe de pasta', (ps) => { ps[0].id = '..' + path.sep + '..' + path.sep + fuga; }],
    ['id repetido', (ps) => { ps[1].id = ps[0].id; }],
    ['id que so difere na caixa', (ps) => { ps[1].id = ps[0].id.toUpperCase(); }],
    ['pergunta so de espacos', (ps) => { ps[0].texto = '   '; }],
    // no 2o prompt: o 1o ja teria pago 3 execucoes quando o brinquedo do 2o estourasse
    ['arquivo do prompt que sai do brinquedo', (ps) => { ps[1].arquivos = { ['..' + path.sep + fuga + '.txt']: 'x' }; }],
    ['arquivo do prompt que nao e texto', (ps) => { ps[1].arquivos = { 'src/a.txt': 7 }; }],
    ['arquivos que nao e objeto', (ps) => { ps[1].arquivos = 'src/a.txt'; }]
  ];
  casos.forEach(([nome, troca]) => {
    const a = ambienteFalso();
    const copia = path.join(a.dir, 'plugin');
    ['scripts', 'modelos'].forEach((d) => fs.cpSync(path.join(RAIZ, d), path.join(copia, d), { recursive: true }));
    const arquivo = path.join(copia, 'modelos', 'qualidade-prompts.json');
    const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    troca(dados.prompts);
    fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2), 'utf8');
    const destino = path.join(a.dir, 'brinquedos');
    fs.mkdirSync(a.onde, { recursive: true });
    const r = spawnSync(process.execPath, [path.join(copia, 'scripts', 'medir-qualidade.js'), '--gerar', '--modelo', 'modelo-x', '--destino', destino],
      { cwd: a.onde, encoding: 'utf8', env: Object.assign({}, process.env, { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config }), timeout: 120000 });
    assert.notStrictEqual(r.status, 0, nome + ': gerou');
    assert.ok(/prompt/.test(r.stderr), nome + ': a recusa nao diz que o problema e o prompt: ' + r.stderr);
    assert.ok(!fs.existsSync(a.log), nome + ': o claude rodou');
    assert.ok(!fs.existsSync(destino), nome + ': criou o destino');
    assert.ok(!fs.existsSync(path.join(a.onde, '.claude')), nome + ': criou a rodada');
    assert.deepStrictEqual(fs.readdirSync(a.dir).filter((n) => n.indexOf(fuga) === 0), [], nome + ': gravou fora do destino');
  });
});

test('cli: --gerar monta todos os brinquedos antes da 1a execucao - arquivo do prompt que o disco recusa nao gasta execucao', () => {
  // passa na conferencia (dentro do brinquedo, com texto), mas um arquivo e a pasta do outro: so o disco recusa
  const casos = [
    ['arquivo antes da pasta de mesmo nome', { 'src': 'x', 'src/a.js': 'y' }],
    ['pasta antes do arquivo de mesmo nome', { 'src/a.js': 'y', 'src': 'x' }]
  ];
  casos.forEach(([nome, arquivos]) => {
    const a = ambienteFalso();
    const copia = path.join(a.dir, 'plugin');
    ['scripts', 'modelos'].forEach((d) => fs.cpSync(path.join(RAIZ, d), path.join(copia, d), { recursive: true }));
    const arquivo = path.join(copia, 'modelos', 'qualidade-prompts.json');
    const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    dados.prompts[1].arquivos = arquivos;
    fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2), 'utf8');
    fs.mkdirSync(a.onde, { recursive: true });
    const r = spawnSync(process.execPath, [path.join(copia, 'scripts', 'medir-qualidade.js'), '--gerar', '--modelo', 'modelo-x', '--destino', path.join(a.dir, 'brinquedos')],
      { cwd: a.onde, encoding: 'utf8', env: Object.assign({}, process.env, { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config }), timeout: 120000 });
    assert.notStrictEqual(r.status, 0, nome + ': gerou');
    assert.ok(!fs.existsSync(a.log), nome + ': o claude rodou antes do brinquedo que falha');
    assert.ok(/prompt 2/.test(r.stderr), nome + ': a recusa nao diz qual prompt: ' + r.stderr);
  });
});

/** Uma rodada de mentira, como o --gerar a deixaria: 2 prompts, 6 geracoes validas. */
function rodadaDeMentira(ajusta) {
  const dir = pasta();
  const prompts = [
    { id: 'explicar-9', tipo: 'explicar', idioma: 'pt', texto: 'Pergunta de mentira numero um, com mais de vinte letras?' },
    { id: 'decisao-9', tipo: 'decisao', idioma: 'en', texto: 'Question of lies number two, with more than twenty letters?' }
  ];
  const lista = [];
  const tokens = { padrao: 300, caveman: 100, recurso: 200 };
  prompts.forEach((p) => medicao.CONDICOES.forEach((c) => {
    const g = { prompt: p.id, condicao: c, ok: true, texto: 'linha 1 de ' + c + '\nlinha 2 de ' + c + ' em ' + p.id, aplicou: true, outputTokens: tokens[c] };
    if (ajusta) ajusta(g);
    lista.push(g);
  }));
  fs.writeFileSync(path.join(dir, 'geracoes.json'),
    JSON.stringify({ versao: 1, modelo: 'modelo-x', carimbo: 'c', completo: true, prompts: prompts, geracoes: lista }, null, 2), 'utf8');
  return dir;
}

function listar(dir) {
  const todos = [];
  (function varre(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) varre(p); else todos.push(p);
    });
  })(dir);
  return todos;
}

test('cli: --pares monta A.txt, B.txt e vereditos/ por prompt x rival x ordem, e o mapa FORA de pares/', () => {
  const rodada = rodadaDeMentira();
  const r = cli(['--pares', rodada]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);

  const pares = fs.readdirSync(path.join(rodada, 'pares')).sort();
  assert.deepStrictEqual(pares, [
    'decisao-9-caveman-1', 'decisao-9-caveman-2', 'decisao-9-padrao-1', 'decisao-9-padrao-2',
    'explicar-9-caveman-1', 'explicar-9-caveman-2', 'explicar-9-padrao-1', 'explicar-9-padrao-2'
  ]);
  pares.forEach((p) => {
    const d = path.join(rodada, 'pares', p);
    assert.deepStrictEqual(fs.readdirSync(d).sort(), ['A.txt', 'B.txt', 'vereditos']);
    assert.deepStrictEqual(fs.readdirSync(path.join(d, 'vereditos')), [], p + ': vereditos/ nao esta vazia');
  });

  // o mapa fica fora de pares/: o inspetor nao pode achar a resposta
  assert.ok(fs.existsSync(path.join(rodada, 'mapa.json')));
  assert.deepStrictEqual(listar(path.join(rodada, 'pares')).filter((f) => /mapa/i.test(path.basename(f))), [],
    'mapa.json (ou qualquer arquivo de mapa) dentro de pares/');
  const mapa = JSON.parse(fs.readFileSync(path.join(rodada, 'mapa.json'), 'utf8'));
  assert.strictEqual(mapa.pares['explicar-9-caveman-1'].A, 'recurso');
  assert.strictEqual(mapa.pares['explicar-9-caveman-1'].B, 'caveman');
  assert.strictEqual(mapa.pares['explicar-9-caveman-2'].A, 'caveman', 'ordem 2: recurso e o B');
  assert.strictEqual(mapa.pares['explicar-9-caveman-2'].B, 'recurso');
  assert.strictEqual(mapa.pares['decisao-9-padrao-2'].A, 'padrao');

  // o artefato: a pergunta + todo o texto visivel, sem prefixo de linha e sem nada que denuncie o lado
  const a1 = fs.readFileSync(path.join(rodada, 'pares', 'explicar-9-caveman-1', 'A.txt'), 'utf8');
  const b1 = fs.readFileSync(path.join(rodada, 'pares', 'explicar-9-caveman-1', 'B.txt'), 'utf8');
  assert.ok(a1.indexOf('Pergunta de mentira numero um') !== -1, 'a pergunta tem de ir no artefato');
  assert.ok(a1.indexOf('linha 2 de recurso em explicar-9') !== -1, 'o texto visivel inteiro');
  assert.ok(b1.indexOf('linha 2 de caveman em explicar-9') !== -1);
  assert.strictEqual(a1.indexOf('/caveman'), -1);
  assert.strictEqual(b1.indexOf('/caveman'), -1, 'o comando do caveman entregaria o lado');
  assert.ok(!/\r/.test(a1), 'LF');
  assert.ok(!/^\s*\d+[:|)]/m.test(a1), 'sem prefixo de numero de linha: o numero e o do proprio arquivo');
  const b2 = fs.readFileSync(path.join(rodada, 'pares', 'explicar-9-caveman-2', 'B.txt'), 'utf8');
  assert.ok(b2.indexOf('linha 2 de recurso em explicar-9') !== -1, 'ordem 2: o recurso passa para o B');
  [a1, b1].forEach((t) => assert.ok(!/recurso|caveman|padrao/i.test(t.split('\n')[0] + t.split('\n')[1]), 'o cabecalho entrega o lado'));
});

test('cli: --pares imprime o briefing do juiz - a lente literal e os caminhos de cada par', () => {
  const rodada = rodadaDeMentira();
  const r = cli(['--pares', rodada]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.indexOf(medicao.LENTE.pergunta) !== -1, 'a pergunta literal da lente');
  assert.ok(r.stdout.indexOf(medicao.LENTE.chave) !== -1);
  assert.ok(r.stdout.indexOf(medicao.LENTE.titulo) !== -1);
  const par = path.join(rodada, 'pares', 'explicar-9-caveman-1');
  assert.ok(r.stdout.indexOf(path.join(par, 'A.txt')) !== -1, 'caminho do A.txt');
  assert.ok(r.stdout.indexOf(path.join(par, 'B.txt')) !== -1);
  assert.ok(r.stdout.indexOf(path.join(par, 'vereditos')) !== -1, 'a pasta vereditos que o inspetor copia');
  assert.strictEqual(r.stdout.indexOf('mapa.json'), -1, 'o briefing nao cita o mapa');
  assert.ok(!/recurso/i.test(r.stdout.split(medicao.LENTE.pergunta)[1] || ''), 'o briefing dos pares entrega quem e quem');
});

test('cli: --pares nao refaz o que ja existe, e recusa rodada invalida', () => {
  const rodada = rodadaDeMentira();
  assert.strictEqual(cli(['--pares', rodada]).status, 0);
  fs.writeFileSync(path.join(rodada, 'pares', 'explicar-9-caveman-1', 'vereditos', 'clareza.json'), '{}', 'utf8');
  const de_novo = cli(['--pares', rodada]);
  assert.notStrictEqual(de_novo.status, 0, 'refez a pasta de pares por cima de veredito');
  assert.ok(fs.existsSync(path.join(rodada, 'pares', 'explicar-9-caveman-1', 'vereditos', 'clareza.json')));

  const ruim = rodadaDeMentira((g) => { if (g.condicao === 'caveman' && g.prompt === 'decisao-9') g.aplicou = false; });
  const r = cli(['--pares', ruim]);
  assert.notStrictEqual(r.status, 0, 'montou 48 juizes de uma rodada invalida');
  assert.ok(!fs.existsSync(path.join(ruim, 'pares')));
  assert.ok(/decisao-9/.test(r.stdout + r.stderr), 'a recusa diz qual geracao');
});

test('cli: --pares que falha no meio nao deixa pares/ pela metade, e a retentativa monta', () => {
  // prompt sem texto em geracoes.json: o artefato nao se monta. Nada de pares/ parcial que barre a retentativa.
  const rodada = rodadaDeMentira();
  const arquivo = path.join(rodada, 'geracoes.json');
  const ger = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const texto = ger.prompts[1].texto;
  delete ger.prompts[1].texto;
  fs.writeFileSync(arquivo, JSON.stringify(ger), 'utf8');
  const r = cli(['--pares', rodada]);
  assert.notStrictEqual(r.status, 0, 'montou par sem a pergunta');
  assert.ok(!fs.existsSync(path.join(rodada, 'pares')), 'pares/ ficou pela metade');
  assert.ok(!fs.existsSync(path.join(rodada, 'mapa.json')));
  ger.prompts[1].texto = texto;
  fs.writeFileSync(arquivo, JSON.stringify(ger), 'utf8');
  const de_novo = cli(['--pares', rodada]);
  assert.strictEqual(de_novo.status, 0, de_novo.stdout + de_novo.stderr);
  assert.strictEqual(fs.readdirSync(path.join(rodada, 'pares')).length, 8);
});

/** A rodada de mentira com o 2o prompt trocado (`troca(prompt, geracoesDele)`), regravada em geracoes.json. */
function rodadaComPromptTrocado(troca) {
  const rodada = rodadaDeMentira();
  const arquivo = path.join(rodada, 'geracoes.json');
  const ger = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const p = ger.prompts[1];
  troca(p, ger.geracoes.filter((g) => g.prompt === p.id), ger);
  fs.writeFileSync(arquivo, JSON.stringify(ger), 'utf8');
  return rodada;
}

test('cli: --pares recusa prompt cujo id nao serve de nome de pasta, id repetido ou pergunta vazia, sem criar nada', () => {
  const fuga = 'fuga-' + process.pid + '-' + Date.now();
  const trocarId = (novo) => (p, dele) => { dele.forEach((g) => { g.prompt = novo; }); p.id = novo; };
  const casos = [
    ['id com barra', trocarId('a/b')],
    ['id que sobe de pasta', trocarId('..' + path.sep + '..' + path.sep + fuga)],
    ['id com dois-pontos', trocarId('x:y')],
    ['id vazio', trocarId('')],
    ['id comprido', trocarId('p'.repeat(65))],
    ['id repetido', (p, dele, ger) => {
      ger.geracoes = ger.geracoes.filter((g) => g.prompt !== p.id);
      p.id = ger.prompts[0].id;
    }],
    // NTFS e APFS nao distinguem caixa: 'EXPLICAR-9' e 'explicar-9' cairiam na mesma pasta de par
    ['id que so difere na caixa', trocarId('EXPLICAR-9'), /id repetido/],
    ['id que so difere na caixa, maiusculo primeiro', (p, dele, ger) => {
      ger.geracoes.filter((g) => g.prompt === ger.prompts[0].id).forEach((g) => { g.prompt = 'DECISAO-9'; });
      ger.prompts[0].id = 'DECISAO-9';
    }, /id repetido/],
    ['pergunta so de espacos', (p) => { p.texto = '   '; }]
  ];
  casos.forEach(([nome, troca, motivo]) => {
    const rodada = rodadaComPromptTrocado(troca);
    const r = cli(['--pares', rodada]);
    assert.notStrictEqual(r.status, 0, nome + ': montou os pares');
    assert.deepStrictEqual(fs.readdirSync(rodada), ['geracoes.json'], nome + ': criou algo na rodada');
    assert.ok(/prompt/.test(r.stderr), nome + ': a recusa nao diz que o problema e o prompt: ' + r.stderr);
    if (motivo) assert.ok(motivo.test(r.stderr), nome + ': a recusa nao diz o motivo: ' + r.stderr);
    assert.ok(!fs.existsSync(path.join(path.dirname(rodada), fuga + '-caveman-1')), nome + ': gravou fora da rodada');
  });
});

test('cli: --pares que falha ao gravar desfaz pares/ e mapa.json, e a retentativa monta', () => {
  const dirFalha = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-falha-'));
  const quando = [
    ['a 3a gravacao dentro de pares/', 'writeFileSync', "partes.indexOf('pares') !== -1 && ++n === 3"],
    ['a gravacao do mapa.json', 'writeFileSync', "path.basename(alvo) === 'mapa.json'"],
    // pares/ ja esta no lugar quando o mapa.json falha: tem de sair junto
    ['o renome do mapa.json', 'renameSync', "path.basename(alvo) === 'mapa.json'"]
  ];
  quando.forEach(([nome, funcao, condicao], i) => {
    const preload = path.join(dirFalha, 'falha-' + i + '.js');
    fs.writeFileSync(preload, [
      "const fs = require('fs');",
      "const path = require('path');",
      'const original = fs.' + funcao + ';',
      'let n = 0;',
      'fs.' + funcao + ' = function (alvo) {',
      '  const partes = String(alvo).split(path.sep);',
      '  if (' + condicao + ") { const e = new Error('disco cheio de mentira'); e.code = 'ENOSPC'; throw e; }",
      '  return original.apply(this, arguments);',
      '};',
      ''
    ].join('\n'), 'utf8');
    const rodada = rodadaDeMentira();
    // NODE_OPTIONS le a barra invertida como escape dentro das aspas: o caminho vai com barra normal
    const r = cli(['--pares', rodada], { env: { NODE_OPTIONS: '--require "' + preload.split(path.sep).join('/') + '"' } });
    assert.notStrictEqual(r.status, 0, nome + ': a falha nao chegou');
    assert.ok(/disco cheio de mentira/.test(r.stderr), nome + ': ' + r.stderr);
    assert.deepStrictEqual(fs.readdirSync(rodada), ['geracoes.json'], nome + ': sobrou estado da tentativa que falhou');
    const de_novo = cli(['--pares', rodada]);
    assert.strictEqual(de_novo.status, 0, nome + ': ' + de_novo.stdout + de_novo.stderr);
    assert.strictEqual(fs.readdirSync(path.join(rodada, 'pares')).length, 8);
    assert.ok(fs.existsSync(path.join(rodada, 'mapa.json')));
  });
});

/** Um --require que troca funcoes do fs no processo do CLI; `linhas` vem depois de fs e path. */
function preloadDeFalha(linhas) {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-falha-')), 'falha.js');
  fs.writeFileSync(arquivo, ["const fs = require('fs');", "const path = require('path');"].concat(linhas).join('\n') + '\n', 'utf8');
  // NODE_OPTIONS le a barra invertida como escape dentro das aspas: o caminho vai com barra normal
  return { NODE_OPTIONS: '--require "' + arquivo.split(path.sep).join('/') + '"' };
}

test('cli: --pares cujo desfazer tambem falha diz o erro de origem e o que ficou, e a retentativa monta', () => {
  const env = preloadDeFalha([
    'const original = fs.writeFileSync;',
    'let n = 0;',
    'fs.writeFileSync = function (alvo) {',
    "  if (String(alvo).split(path.sep).indexOf('pares') !== -1 && ++n === 3) { const e = new Error('disco cheio de mentira'); e.code = 'ENOSPC'; throw e; }",
    '  return original.apply(this, arguments);',
    '};',
    "fs.rmSync = function () { const e = new Error('arquivo preso de mentira'); e.code = 'EBUSY'; throw e; };"
  ]);
  const rodada = rodadaDeMentira();
  const r = cli(['--pares', rodada], { env: env });
  assert.notStrictEqual(r.status, 0, 'a falha nao chegou');
  assert.ok(/disco cheio de mentira/.test(r.stderr), 'o erro de origem sumiu: ' + r.stderr);
  assert.ok(/EBUSY/.test(r.stderr), 'nao diz que o desfazer falhou: ' + r.stderr);
  assert.ok(!fs.existsSync(path.join(rodada, 'pares')), 'pares/ ficou e barra a retentativa');
  assert.ok(!fs.existsSync(path.join(rodada, 'mapa.json')));
  const de_novo = cli(['--pares', rodada]);
  assert.strictEqual(de_novo.status, 0, de_novo.stdout + de_novo.stderr);
  assert.strictEqual(fs.readdirSync(path.join(rodada, 'pares')).length, 8);
});

test('cli: --pares cujo processo morre no meio nao deixa pares/ nem mapa.json, e a retentativa monta', () => {
  // Ctrl+C, queda: nenhum catch roda. A trava de pares/ e mapa.json nao pode ver o que sobrou dessa tentativa.
  const quando = [
    ['na 3a gravacao dentro de pares/', "String(alvo).split(path.sep).indexOf('pares') !== -1 && ++n === 3"],
    ['na gravacao do mapa.json', "path.basename(String(alvo)) === 'mapa.json'"]
  ];
  quando.forEach(([nome, condicao]) => {
    const env = preloadDeFalha([
      'const original = fs.writeFileSync;',
      'let n = 0;',
      'fs.writeFileSync = function (alvo) {',
      '  if (' + condicao + ") process.kill(process.pid, 'SIGKILL');",
      '  return original.apply(this, arguments);',
      '};'
    ]);
    const rodada = rodadaDeMentira();
    const r = cli(['--pares', rodada], { env: env });
    assert.notStrictEqual(r.status, 0, nome + ': o processo nao morreu');
    assert.ok(!fs.existsSync(path.join(rodada, 'pares')), nome + ': pares/ pela metade barra a retentativa');
    assert.ok(!fs.existsSync(path.join(rodada, 'mapa.json')), nome + ': mapa.json sem os pares barra a retentativa');
    const de_novo = cli(['--pares', rodada]);
    assert.strictEqual(de_novo.status, 0, nome + ': ' + de_novo.stdout + de_novo.stderr);
    assert.strictEqual(fs.readdirSync(path.join(rodada, 'pares')).length, 8);
    assert.ok(fs.existsSync(path.join(rodada, 'mapa.json')));
  });
});

test('cli: --pares morto entre os dois renomes: a recusa diz que a montagem parou e o que apagar, e com veredito segue protegendo', () => {
  // o briefing so sai depois do mapa.json: pares/ sem mapa.json e sem veredito nenhum nao tem juiz esperando
  const morrer = preloadDeFalha([
    'const original = fs.renameSync;',
    'fs.renameSync = function (alvo) {',
    "  if (path.basename(String(alvo)) === 'mapa.json') process.kill(process.pid, 'SIGKILL');",
    '  return original.apply(this, arguments);',
    '};'
  ]);
  const casos = [
    ['sem veredito', null],
    // alguem ja julgou e o mapa.json sumiu depois: apagar pares/ perderia o veredito
    ['com um veredito dentro', 'explicar-9-padrao-2']
  ];
  casos.forEach(([nome, julgado]) => {
    const rodada = rodadaDeMentira();
    const r = cli(['--pares', rodada], { env: morrer });
    assert.notStrictEqual(r.status, 0, nome + ': o processo nao morreu');
    assert.ok(fs.existsSync(path.join(rodada, 'pares')) && !fs.existsSync(path.join(rodada, 'mapa.json')), nome + ': nao parou entre os renomes');
    if (julgado) fs.writeFileSync(path.join(rodada, 'pares', julgado, 'vereditos', 'clareza.json'), '{}', 'utf8');
    const recusa = cli(['--pares', rodada]);
    assert.notStrictEqual(recusa.status, 0, nome + ': refez por cima');
    if (julgado) {
      assert.ok(/veredito que se perderia/.test(recusa.stderr), nome + ': ' + recusa.stderr);
      assert.ok(!/interrompida/.test(recusa.stderr), nome + ': mandou apagar pares/ com veredito dentro: ' + recusa.stderr);
      assert.ok(fs.existsSync(path.join(rodada, 'pares', julgado, 'vereditos', 'clareza.json')));
      return;
    }
    assert.ok(!/veredito que se perderia/.test(recusa.stderr), nome + ': a recusa diz que ha veredito, e nao ha: ' + recusa.stderr);
    assert.ok(/interrompida/.test(recusa.stderr), nome + ': ' + recusa.stderr);
    assert.ok(recusa.stderr.indexOf(path.join(rodada, 'pares')) !== -1, nome + ': nao diz o que apagar: ' + recusa.stderr);
    // seguir a recusa resolve
    fs.rmSync(path.join(rodada, 'pares'), { recursive: true, force: true });
    const de_novo = cli(['--pares', rodada]);
    assert.strictEqual(de_novo.status, 0, nome + ': ' + de_novo.stdout + de_novo.stderr);
    assert.strictEqual(fs.readdirSync(path.join(rodada, 'pares')).length, 8);
  });
});

test('cli: --pares ja montado e sem veredito: a recusa nao diz que ha veredito, e diz o que apagar', () => {
  const casos = [
    // o briefing se perdeu (terminal fechado, processo morto antes de imprimir): pares/ e mapa.json, nenhum veredito
    ['pares/ e mapa.json sem veredito', () => {}, ['pares', 'mapa.json']],
    ['so o mapa.json', (rodada) => fs.renameSync(path.join(rodada, 'pares'), path.join(rodada, 'pares-tirada')), ['mapa.json']],
    // controle: com veredito, a recusa protege e diz por que
    ['pares/ e mapa.json com veredito', (rodada) => fs.writeFileSync(path.join(rodada, 'pares', 'decisao-9-caveman-1', 'vereditos', 'clareza.json'), '{}', 'utf8'), null]
  ];
  casos.forEach(([nome, prepara, apagar]) => {
    const rodada = rodadaDeMentira();
    assert.strictEqual(cli(['--pares', rodada]).status, 0);
    prepara(rodada);
    const recusa = cli(['--pares', rodada]);
    assert.notStrictEqual(recusa.status, 0, nome + ': refez por cima');
    if (!apagar) {
      assert.ok(/veredito que se perderia/.test(recusa.stderr), nome + ': ' + recusa.stderr);
      return;
    }
    assert.ok(!/veredito que se perderia/.test(recusa.stderr), nome + ': a recusa diz que ha veredito, e nao ha: ' + recusa.stderr);
    apagar.forEach((p) => assert.ok(recusa.stderr.indexOf(path.join(rodada, p)) !== -1, nome + ': nao diz que apagar ' + p + ': ' + recusa.stderr));
    ['pares', 'mapa.json'].filter((p) => apagar.indexOf(p) === -1).forEach((p) => {
      assert.strictEqual(recusa.stderr.indexOf(path.join(rodada, p)), -1, nome + ': manda apagar ' + p + ', que nao existe: ' + recusa.stderr);
    });
    // seguir a recusa resolve
    apagar.forEach((p) => fs.rmSync(path.join(rodada, p), { recursive: true, force: true }));
    const de_novo = cli(['--pares', rodada]);
    assert.strictEqual(de_novo.status, 0, nome + ': ' + de_novo.stdout + de_novo.stderr);
  });
});

test('cli: --pares que nao consegue ler pares/ nao afirma veredito: diz que nao leu e o que conferir, e recusa', () => {
  const casos = [
    ['pares/ e um arquivo', (rodada) => fs.writeFileSync(path.join(rodada, 'pares'), 'nao sou pasta', 'utf8')],
    ['vereditos/ de um par e um arquivo', (rodada) => {
      assert.strictEqual(cli(['--pares', rodada]).status, 0);
      const v = path.join(rodada, 'pares', 'explicar-9-padrao-1', 'vereditos');
      fs.rmdirSync(v);
      fs.writeFileSync(v, 'nao sou pasta', 'utf8');
    }]
  ];
  casos.forEach(([nome, prepara]) => {
    const rodada = rodadaDeMentira();
    prepara(rodada);
    const recusa = cli(['--pares', rodada]);
    assert.notStrictEqual(recusa.status, 0, nome + ': refez por cima');
    assert.ok(!/veredito que se perderia/.test(recusa.stderr), nome + ': afirma veredito sem ter lido: ' + recusa.stderr);
    assert.ok(/nao consegui ler/.test(recusa.stderr), nome + ': ' + recusa.stderr);
    assert.ok(recusa.stderr.indexOf(path.join(rodada, 'pares')) !== -1, nome + ': nao diz o que conferir: ' + recusa.stderr);
    assert.ok(fs.existsSync(path.join(rodada, 'pares')), nome + ': apagou');
  });
});

test('cli: --pares tira a montagem de processo morto que sobrou na rodada, e deixa a de processo vivo', () => {
  // o processo morto no meio (Ctrl+C, queda) deixa montagem-<pid>-<hora> com o mapa.json dentro; a retentativa a tira.
  // A de processo vivo pode ser outra montagem em curso: fica
  const morrer = preloadDeFalha([
    'const original = fs.writeFileSync;',
    'fs.writeFileSync = function (alvo) {',
    '  const s = original.apply(this, arguments);',
    "  if (path.basename(String(alvo)) === 'mapa.json') process.kill(process.pid, 'SIGKILL');",
    '  return s;',
    '};'
  ]);
  const rodada = rodadaDeMentira();
  const r = cli(['--pares', rodada], { env: morrer });
  assert.notStrictEqual(r.status, 0, 'o processo nao morreu');
  const mortas = fs.readdirSync(rodada).filter((n) => /^montagem-/.test(n));
  assert.strictEqual(mortas.length, 1, 'a morte nao deixou a montagem: ' + mortas);
  assert.ok(fs.existsSync(path.join(rodada, mortas[0], 'mapa.json')), 'a montagem morta nao tem o mapa.json');
  const viva = path.join(rodada, 'montagem-' + process.pid + '-' + Date.now());
  fs.mkdirSync(viva);
  fs.writeFileSync(path.join(viva, 'mapa.json'), '{}', 'utf8');
  const de_novo = cli(['--pares', rodada]);
  assert.strictEqual(de_novo.status, 0, de_novo.stdout + de_novo.stderr);
  assert.ok(!fs.existsSync(path.join(rodada, mortas[0])), 'a montagem do processo morto ficou, com o mapa.json dentro');
  assert.ok(fs.existsSync(path.join(viva, 'mapa.json')), 'apagou a montagem de um processo vivo');
  assert.strictEqual(fs.readdirSync(path.join(rodada, 'pares')).length, 8);
});

test('cli: --pares com geracao gravada com outro tipo no prompt recusa dizendo qual, sem criar nada', () => {
  // a chave do apurar junta prompt e condicao como texto (7 e "7" casam); o par procura com ===. Sem esta conferencia,
  // TypeError cru, sem dizer a geracao
  const casos = [
    ['prompt numero', (p, dele) => { p.id = '7'; dele.forEach((g) => { g.prompt = 7; }); }, '7/'],
    ['prompt lista', (p, dele) => { dele.forEach((g) => { g.prompt = [p.id]; }); }, 'decisao-9/']
  ];
  casos.forEach(([nome, troca, onde]) => {
    const rodada = rodadaComPromptTrocado(troca);
    const r = cli(['--pares', rodada]);
    assert.notStrictEqual(r.status, 0, nome + ': montou');
    assert.deepStrictEqual(fs.readdirSync(rodada), ['geracoes.json'], nome + ': criou algo na rodada');
    assert.ok(r.stderr.indexOf(onde + 'padrao') !== -1, nome + ': a recusa nao diz a geracao: ' + r.stderr);
    assert.ok(!/Cannot read|TypeError/.test(r.stderr), nome + ': ' + r.stderr);
  });
});

test('cli: --pares sem geracoes.json recusa', () => {
  const r = cli(['--pares', pasta()]);
  assert.notStrictEqual(r.status, 0);
});

/** Grava o veredito de um par: `quem` diz quem vence, e o arquivo sai coerente com a ordem. */
function julgar(rodada, par, quem) {
  const mapa = JSON.parse(fs.readFileSync(path.join(rodada, 'mapa.json'), 'utf8')).pares[par];
  const melhor = quem === 'empate' ? 'empate' : (mapa.A === quem ? 'A' : 'B');
  fs.writeFileSync(path.join(rodada, 'pares', par, 'vereditos', 'clareza.json'),
    JSON.stringify({ lente: 'clareza', melhor: melhor, porQue: 'A.txt:2 diz o que fazer a seguir', achados: [] }), 'utf8');
}

test('cli: --veredito com todos os pares julgados imprime o veredito, o placar e os tokens dos 3 (exit 0)', () => {
  const rodada = rodadaDeMentira();
  assert.strictEqual(cli(['--pares', rodada]).status, 0);
  fs.readdirSync(path.join(rodada, 'pares')).forEach((p) => julgar(rodada, p, 'recurso'));
  const r = cli(['--veredito', rodada]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(/GANHA/.test(r.stdout) && !/NAO GANHA/.test(r.stdout), r.stdout);
  assert.ok(/caveman[^\n]*2 vitorias|vitorias[^\n]*2[^\n]*caveman/i.test(r.stdout) || /caveman.*2/.test(r.stdout), 'placar do caveman: ' + r.stdout);
  // tokens: padrao 2x300, caveman 2x100, recurso 2x200 - os do caveman saem sempre
  assert.ok(/padrao[^\n]*600/.test(r.stdout), r.stdout);
  assert.ok(/caveman[^\n]*200/.test(r.stdout), 'os tokens do caveman tem de sair: ' + r.stdout);
  assert.ok(/recurso[^\n]*400/.test(r.stdout), r.stdout);
});

test('cli: --veredito com par sem veredito lista os que faltam e sai 2 - nunca vira empate', () => {
  const rodada = rodadaDeMentira();
  assert.strictEqual(cli(['--pares', rodada]).status, 0);
  fs.readdirSync(path.join(rodada, 'pares')).forEach((p) => { if (p !== 'decisao-9-padrao-2') julgar(rodada, p, 'recurso'); });
  const r = cli(['--veredito', rodada]);
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.ok(r.stdout.indexOf('decisao-9/padrao/2') !== -1, 'tem de nomear o par que falta: ' + r.stdout);
  assert.ok(!/VEREDITO: (?:GANHA|NAO GANHA|INCONCLUSIVO|INVALIDO)/.test(r.stdout), r.stdout);
  assert.ok(/caveman[^\n]*200/.test(r.stdout), 'mesmo sem veredito os tokens dos 3 saem: ' + r.stdout);
});

test('cli: --veredito com JSON ilegivel na pasta do juiz tambem faltam - nao e empate', () => {
  const rodada = rodadaDeMentira();
  assert.strictEqual(cli(['--pares', rodada]).status, 0);
  fs.readdirSync(path.join(rodada, 'pares')).forEach((p) => julgar(rodada, p, 'recurso'));
  fs.writeFileSync(path.join(rodada, 'pares', 'explicar-9-caveman-1', 'vereditos', 'clareza.json'), '{quebrado', 'utf8');
  const r = cli(['--veredito', rodada]);
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.ok(r.stdout.indexOf('explicar-9/caveman/1') !== -1, r.stdout);
});

test('cli: --veredito com veredito sem o campo melhor (vazio, lista) e falta, nao empate; com melhor e sem citacao segue empate', () => {
  const casos = [
    ['objeto vazio', '{}', true],
    ['lista vazia', '[]', true],
    ['lista com o voto dentro', '[{"melhor":"A","porQue":"A.txt:1 claro"}]', true],
    ['melhor que nao e texto', '{"melhor":1,"porQue":"A.txt:1 claro"}', true],
    ['so o porQue', '{"porQue":"A.txt:1 claro"}', true],
    // controle: e voto, e sem citacao vira empate (spec), nao falta
    ['melhor sem citacao', '{"melhor":"A"}', false]
  ];
  casos.forEach(([nome, json, falta]) => {
    const rodada = rodadaDeMentira();
    assert.strictEqual(cli(['--pares', rodada]).status, 0);
    fs.readdirSync(path.join(rodada, 'pares')).forEach((p) => julgar(rodada, p, 'recurso'));
    fs.writeFileSync(path.join(rodada, 'pares', 'explicar-9-caveman-1', 'vereditos', 'clareza.json'), json, 'utf8');
    const r = cli(['--veredito', rodada]);
    if (!falta) {
      assert.strictEqual(r.status, 0, nome + ': ' + r.stdout + r.stderr);
      assert.ok(/placar contra caveman: 1 vitorias, 0 derrotas, 1 empates/.test(r.stdout), nome + ': ' + r.stdout);
      assert.ok(!/falta:/.test(r.stdout), nome + ': voto com melhor virou falta: ' + r.stdout);
      return;
    }
    assert.strictEqual(r.status, 2, nome + ': contou como voto: ' + r.stdout + r.stderr);
    assert.ok(r.stdout.indexOf('falta: explicar-9/caveman/1') !== -1, nome + ': ' + r.stdout);
    assert.ok(/sem o campo melhor/.test(r.stdout), nome + ': nao diz por que faltou: ' + r.stdout);
  });
});

test('cli: --veredito dado NAO GANHA ainda sai 0 e diz o motivo, com os tokens', () => {
  const rodada = rodadaDeMentira();
  assert.strictEqual(cli(['--pares', rodada]).status, 0);
  fs.readdirSync(path.join(rodada, 'pares')).forEach((p) => julgar(rodada, p, /caveman/.test(p) ? 'caveman' : 'recurso'));
  const r = cli(['--veredito', rodada]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(/NAO GANHA/.test(r.stdout), r.stdout);
  assert.ok(/caveman[^\n]*200/.test(r.stdout));
});

test('cli: --veredito de rodada invalida diz INVALIDO e o motivo', () => {
  const rodada = rodadaDeMentira((g) => { if (g.prompt === 'explicar-9' && g.condicao === 'recurso') g.outputTokens = undefined; });
  const r = cli(['--veredito', rodada]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(/INVALIDO/.test(r.stdout), r.stdout);
  assert.ok(/explicar-9/.test(r.stdout), 'o motivo nomeia a geracao: ' + r.stdout);
});

// ── como o claude e achado, no Windows e fora dele ──────────────────────

const { resolverClaude, montarBrinquedo, acharTranscricao } = require('../scripts/medir-qualidade.js');

test('resolverClaude: SWORN_CLAUDE manda; .js roda pelo node, o resto direto', () => {
  const a = ambienteFalso();
  const js = resolverClaude({ SWORN_CLAUDE: a.fake }, 'win32');
  assert.strictEqual(js.exe, process.execPath);
  assert.deepStrictEqual(js.prefixo, [a.fake]);
  const bin = path.join(a.dir, 'claude bin');
  fs.writeFileSync(bin, 'x');
  const direto = resolverClaude({ SWORN_CLAUDE: bin }, 'linux');
  assert.strictEqual(direto.exe, bin);
  assert.deepStrictEqual(direto.prefixo, []);
  assert.strictEqual(resolverClaude({ SWORN_CLAUDE: path.join(a.dir, 'nao existe') }, 'linux'), null);
});

test('resolverClaude: no Windows o atalho .cmd do npm leva ao .exe de verdade, com espaco no caminho', () => {
  const dir = pasta();
  const npm = path.join(dir, 'pasta npm');
  const exe = path.join(npm, 'node_modules', '@x', 'claude-code', 'bin', 'claude.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, 'x');
  fs.writeFileSync(path.join(npm, 'claude.cmd'), [
    '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0',
    '"%dp0%\\node_modules\\@x\\claude-code\\bin\\claude.exe"   %*', ''
  ].join('\r\n'));
  fs.writeFileSync(path.join(npm, 'claude'), '#!/bin/sh\n');
  const r = resolverClaude({ PATH: npm }, 'win32');
  assert.ok(r, 'nao achou o claude pelo atalho');
  assert.strictEqual(path.normalize(r.exe), path.normalize(exe));
  assert.deepStrictEqual(r.prefixo, []);
});

test('resolverClaude: atalho .cmd que chama um script .js roda pelo node', () => {
  const dir = pasta();
  const js = path.join(dir, 'lib', 'cli.js');
  fs.mkdirSync(path.dirname(js), { recursive: true });
  fs.writeFileSync(js, '//');
  fs.writeFileSync(path.join(dir, 'claude.cmd'), [
    '@ECHO off', 'SET "_prog=node"', 'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\lib\\cli.js" %*', ''
  ].join('\r\n'));
  const r = resolverClaude({ PATH: dir }, 'win32');
  assert.ok(r);
  assert.strictEqual(r.exe, process.execPath);
  assert.deepStrictEqual(r.prefixo.map(path.normalize), [path.normalize(js)]);
});

test('resolverClaude: .exe no PATH vale direto; fora do Windows o nome puro basta', () => {
  const dir = pasta();
  const exe = path.join(dir, 'claude.exe');
  fs.writeFileSync(exe, 'x');
  assert.strictEqual(path.normalize(resolverClaude({ PATH: dir }, 'win32').exe), path.normalize(exe));
  const outro = pasta();
  const nome = path.join(outro, 'claude');
  fs.writeFileSync(nome, '#!/bin/sh\n');
  assert.strictEqual(path.normalize(resolverClaude({ PATH: outro }, 'linux').exe), path.normalize(nome));
  assert.strictEqual(resolverClaude({ PATH: pasta() }, 'linux'), null, 'sem claude no PATH nao ha o que resolver');
  assert.strictEqual(resolverClaude({}, 'linux'), null);
});

test('resolverClaude: atalho .cmd que nao diz para onde vai nao e adivinhado', () => {
  const dir = pasta();
  fs.writeFileSync(path.join(dir, 'claude.cmd'), '@ECHO off\r\necho oi\r\n');
  assert.strictEqual(resolverClaude({ PATH: dir }, 'win32'), null);
});

// ── o caveman provado pela transcricao da sessao ────────────────────────

function comando(nome) {
  return '<command-message>' + nome + '</command-message>\n<command-name>/' + nome + '</command-name>\n<command-args>pergunta</command-args>';
}

function transcricaoDe(nome, forma) {
  const conteudo = forma === 'blocos' ? [{ type: 'text', text: comando(nome) }] : comando(nome);
  return [
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue' }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: conteudo } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: /algum/lugar/' + nome }] } })
  ];
}

test('medicao/cavemanNaTranscricao: so o comando caveman exato, expandido, liga', () => {
  assert.strictEqual(medicao.cavemanNaTranscricao(transcricaoDe('caveman')), true);
  assert.strictEqual(medicao.cavemanNaTranscricao(transcricaoDe('caveman', 'blocos')), true, 'conteudo em blocos');
  assert.strictEqual(medicao.cavemanNaTranscricao(transcricaoDe('caveman').join('\r\n')), true, 'texto unico');
  assert.strictEqual(medicao.cavemanNaTranscricao(transcricaoDe('caveman-commit')), false, 'outro comando com o mesmo prefixo');
  assert.strictEqual(medicao.cavemanNaTranscricao(transcricaoDe('caveman-help')), false);
  assert.strictEqual(medicao.cavemanNaTranscricao(transcricaoDe('outro')), false);
  assert.strictEqual(medicao.cavemanNaTranscricao(['', 'lixo', '{quebrado']), false);
  assert.strictEqual(medicao.cavemanNaTranscricao(undefined), false);
  // so evento de usuario: a palavra num texto do assistente nao e o comando
  const doAssistente = [JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: comando('caveman') }] } })];
  assert.strictEqual(medicao.cavemanNaTranscricao(doAssistente), false);
});

test('medicao/lerTranscricao: legivel so com evento JSON de verdade', () => {
  assert.strictEqual(medicao.lerTranscricao(transcricaoDe('caveman')).legivel, true);
  assert.strictEqual(medicao.lerTranscricao(['', 'lixo']).legivel, false);
  assert.strictEqual(medicao.lerTranscricao([]).legivel, false);
  assert.strictEqual(medicao.lerTranscricao(null).legivel, false);
});

test('medicao/sessionIdDe: o session_id do stream, ou null', () => {
  assert.strictEqual(medicao.sessionIdDe(stream({})), 's1');
  assert.strictEqual(medicao.sessionIdDe([JSON.stringify({ type: 'result', session_id: 7 }), JSON.stringify({ type: 'x', session_id: 'abc-1' })]), 'abc-1');
  assert.strictEqual(medicao.sessionIdDe(['lixo']), null);
  assert.strictEqual(medicao.sessionIdDe([]), null);
});

test('medicao/lerExecucao: caveman ligado pela transcricao, sem nada no stream', () => {
  const r = ler({}, 'caveman', { transcricao: transcricaoDe('caveman') });
  assert.strictEqual(r.aplicou, true, JSON.stringify(r.motivos));
  assert.strictEqual(r.ok, true);
});

test('medicao/lerExecucao: caveman-commit na transcricao nao liga a condicao caveman', () => {
  const r = ler({}, 'caveman', { transcricao: transcricaoDe('caveman-commit') });
  assert.strictEqual(r.aplicou, false);
  assert.ok(r.motivos.some((m) => /caveman/.test(m)), JSON.stringify(r.motivos));
  assert.ok(!r.motivos.some((m) => /transcricao da sessao nao achada/.test(m)), 'a transcricao foi lida: nao e "nao achada"');
});

test('medicao/lerExecucao: caveman sem transcricao legivel e sem prova no stream -> transcricao da sessao nao achada', () => {
  [undefined, null, [], ['lixo', '']].forEach((t) => {
    const r = ler({}, 'caveman', { transcricao: t });
    assert.strictEqual(r.aplicou, false, JSON.stringify(t));
    assert.ok(r.motivos.some((m) => /transcricao da sessao nao achada/.test(m) && /caveman/.test(m)), JSON.stringify(r.motivos));
  });
  // transcricao lida, sem o comando: nao ligou
  const sem = ler({}, 'caveman', { transcricao: transcricaoDe('outro') });
  assert.strictEqual(sem.aplicou, false);
});

test('medicao/lerExecucao: a prova no stream segue valendo sem transcricao', () => {
  assert.strictEqual(ler({ caveman: true }, 'caveman').aplicou, true);
  assert.strictEqual(ler({ caveman: true }, 'caveman', { transcricao: transcricaoDe('outro') }).aplicou, true);
});

test('medicao/lerExecucao: comando caveman na transcricao do padrao ou do recurso -> nao aplicou', () => {
  const noPadrao = ler({}, 'padrao', { transcricao: transcricaoDe('caveman') });
  assert.strictEqual(noPadrao.aplicou, false);
  assert.ok(noPadrao.motivos.some((m) => /caveman/.test(m)), JSON.stringify(noPadrao.motivos));
  assert.strictEqual(ler({ bloco: true }, 'recurso', { transcricao: transcricaoDe('caveman') }).aplicou, false);
  // controle: a mesma transcricao sem o comando nao atrapalha
  assert.strictEqual(ler({}, 'padrao', { transcricao: transcricaoDe('outro') }).aplicou, true);
  assert.strictEqual(ler({ bloco: true }, 'recurso', { transcricao: transcricaoDe('caveman-commit') }).aplicou, true);
});

// ── onde a transcricao mora ─────────────────────────────────────────────

test('acharTranscricao: procura o session_id em todas as subpastas de projects/, sem calcular o nome', () => {
  const config = pasta();
  fs.mkdirSync(path.join(config, 'projects', 'uma'), { recursive: true });
  fs.mkdirSync(path.join(config, 'projects', 'duas'), { recursive: true });
  fs.writeFileSync(path.join(config, 'projects', 'duas', 'sess-1.jsonl'), '{}\n');
  assert.strictEqual(acharTranscricao('sess-1', { CLAUDE_CONFIG_DIR: config }), path.join(config, 'projects', 'duas', 'sess-1.jsonl'));
  assert.strictEqual(acharTranscricao('sess-2', { CLAUDE_CONFIG_DIR: config }), null);
  assert.strictEqual(acharTranscricao('sess-1', { CLAUDE_CONFIG_DIR: path.join(config, 'nao existe') }), null);
});

test('acharTranscricao: sem CLAUDE_CONFIG_DIR vale a pasta .claude da pasta pessoal; id suspeito nao procura', () => {
  const casa = pasta();
  fs.mkdirSync(path.join(casa, '.claude', 'projects', 'x'), { recursive: true });
  fs.writeFileSync(path.join(casa, '.claude', 'projects', 'x', 'abc.jsonl'), '{}\n');
  assert.strictEqual(acharTranscricao('abc', {}, casa), path.join(casa, '.claude', 'projects', 'x', 'abc.jsonl'));
  ['', null, undefined, '../abc', 'a/b', 'a\\b', 7].forEach((ruim) => {
    assert.strictEqual(acharTranscricao(ruim, {}, casa), null, 'id ' + String(ruim));
  });
});

// ── o brinquedo nasce limpo ─────────────────────────────────────────────

function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false, timeout: 30000, windowsHide: true });
  assert.strictEqual(r.status, 0, 'git ' + args.join(' ') + ': ' + r.stderr);
  return r.stdout;
}

test('brinquedo: nasce commitado - git status vazio, sem arquivo de outra frente para a trava 5', () => {
  const alvo = path.join(pasta(), 'brinquedo');
  const prompt = PROMPTS.prompts.filter((p) => p.id === 'ferramentas-1')[0];
  montarBrinquedo(alvo, prompt, 'recurso');
  assert.strictEqual(git(alvo, ['status', '--porcelain']), '', 'arquivo untracked: o portao o leria como ja modificado');
  assert.strictEqual(git(alvo, ['rev-list', '--count', 'HEAD']).trim(), '1');
  const rastreados = git(alvo, ['ls-files']).split('\n').filter(Boolean).sort();
  assert.ok(rastreados.indexOf('src/preco.js') !== -1, rastreados.join(','));
  assert.ok(rastreados.indexOf('.claude/sworn/projeto.json') !== -1, rastreados.join(','));
  assert.ok(rastreados.indexOf('.claude/sworn/regras.md') !== -1);
});

test('brinquedo: o commit nao depende da identidade do git do usuario nem de assinatura', () => {
  const alvo = path.join(pasta(), 'brinquedo');
  montarBrinquedo(alvo, PROMPTS.prompts.filter((p) => p.tipo === 'explicar')[0], 'padrao');
  const autor = git(alvo, ['log', '-1', '--format=%an <%ae>']).trim();
  assert.strictEqual(autor, 'medicao <medicao@exemplo.com>');
  assert.strictEqual(git(alvo, ['status', '--porcelain']), '');
});

// Ensaio real: sem escopo declarado o portao de escopo do proprio sworn barra o Edit, e o claude
// nao deixa o modelo escrever o escopo.md no modo print - nenhuma condicao fazia a tarefa. E o git
// do modelo, sem caminho longo, falhava ("Filename too long") e gastava tokens so numa delas.
test('brinquedo: nasce com escopo declarado para src/ e com caminho longo ligado no git', () => {
  const escopo = require('../scripts/lib/escopo.js');
  const alvo = path.join(pasta(), 'brinquedo');
  montarBrinquedo(alvo, PROMPTS.prompts.filter((p) => p.id === 'ferramentas-1')[0], 'caveman');
  const e = escopo.parse(fs.readFileSync(path.join(alvo, '.claude', 'sworn', 'escopo.md'), 'utf8'));
  assert.ok(e.objetivo, 'escopo sem objetivo');
  assert.deepStrictEqual(e.dentro, ['src/**']);
  assert.strictEqual(git(alvo, ['config', '--local', 'core.longpaths']).trim(), 'true');
  assert.strictEqual(git(alvo, ['status', '--porcelain']), '', 'o escopo tambem nasce commitado');
});

test('cli: --gerar sem transcricao da sessao para na condicao caveman e diz o motivo', () => {
  const a = ambienteFalso();
  const r = cli(['--gerar', '--modelo', 'modelo-x', '--destino', path.join(a.dir, 'brinquedos'), '--prompt', 'explicar-1'],
    { cwd: a.onde, env: { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config, FAKE_SEM_TRANSCRICAO: '1' } });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  const ger = JSON.parse(fs.readFileSync(path.join(achar(a.onde), 'geracoes.json'), 'utf8'));
  assert.deepStrictEqual(ger.geracoes.map((g) => g.condicao), ['padrao', 'caveman']);
  assert.strictEqual(ger.geracoes[0].aplicou, true, 'o padrao nao precisa da transcricao');
  assert.strictEqual(ger.geracoes[1].aplicou, false);
  assert.ok(ger.geracoes[1].motivos.some((m) => /transcricao da sessao nao achada/.test(m)), JSON.stringify(ger.geracoes[1].motivos));
});

// ── T4 (plano dos 82): medicao ───────────────────────────────────────────

/** Caracteres fora de ASCII por codigo: o arquivo de teste fica em ASCII, e o editor nao os troca. */
function U() { return Array.prototype.map.call(arguments, (c) => String.fromCharCode(c)).join(''); }

test('T4/F7-01: "nao sei" em outras palavras do juiz (1a pessoa, fora de aspas) vira empate; 3a pessoa, aspas e D306 seguem', () => {
  const empate = [
    'A.txt:3 e melhor, mas nao consigo dizer por que',
    'A.txt:3 nao da para saber',
    'A.txt:3 nao tenho como dizer qual e melhor',
    'A.txt:3 A parece melhor, mas impossivel dizer ao certo',
    'A.txt:3 n' + U(0xe3) + 'o consigo decidir',
    'nao consigo escolher; A.txt:3 e B.txt:4 se parecem',
    'Imposs' + U(0xed) + 'vel julgar? nao: impossivel decidir. A.txt:3 e B.txt:4 empatam'
  ];
  empate.forEach((porQue) => assert.strictEqual(medicao.votoDoJuiz(vd('A', porQue)), 'empate', porQue));
  // controle: 3a pessoa, sobre o texto julgado, e citacao entre aspas contam voto
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 o texto B nao consegue dizer o motivo')), 'A');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', "A.txt:3 o B cita 'nao consigo dizer' sem contexto")), 'A');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 o B cita "nao da para saber" e "impossivel dizer"')), 'A');
  // controle: "nao tenho certeza" e ressalva, nao abstencao
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 e melhor, embora nao tenho certeza do rodape')), 'A');
  // controle (D306, prender): "nao sei" sem aspas no meio de frase sobre o texto segue empate
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 A diz nao sei o que fazer')), 'empate');
});

test('T4/F7-02: aspas baixas e angulares simples tambem sao citacao do texto julgado', () => {
  const casos = [
    U(0x201e) + 'nao sei' + U(0x201c),
    U(0x201e) + 'nao sei' + U(0x201d),
    U(0x2039) + 'nao sei' + U(0x203a),
    U(0x201a) + 'nao sei' + U(0x2018),
    U(0x201a) + 'nao sei' + U(0x2019)
  ];
  casos.forEach((citado) => assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 traz ' + citado + ' no rodape')), 'A', citado));
  // controle: abridor baixo sem fecho nao cita nada
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 traz ' + U(0x201e) + 'x e nao sei no rodape')), 'empate');
});

test('T4/F7-03: os preenchedores do hangul (aparecem como espaco) nao escondem o "nao sei"', () => {
  [0x3164, 0x115f, 0x1160, 0xffa0].forEach((c) => {
    assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 nao' + U(c) + 'sei')), 'empate', c.toString(16));
  });
  // controle: o mesmo caractere noutro lugar nao muda o voto
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 chega na conclus' + U(0x3164) + 'ao antes')), 'A');
});

test('T4/F7-04: o fecho curvo usado como abridor (de um lado e do outro) cita; um so, sem par, nao', () => {
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 traz ' + U(0x2019) + 'nao sei' + U(0x2019) + ' no texto')), 'A');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 traz ' + U(0x201d) + 'nao sei' + U(0x201d) + ' no texto')), 'A');
  // controle: uma so, sem par
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 nao sei ' + U(0x2019) + ' solto')), 'empate');
  // aspa curva usada dos dois lados, em numero impar na linha, nao forma citacao: o "nao sei" do juiz aparece
  [0x2019, 0x201d].forEach((c) => {
    assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 ' + U(c) + 'x; nao sei qual e melhor; B.txt:2 repete ' + U(c) + 'y' + U(c))), 'empate', c.toString(16));
  });
  // controle: o par completo segue citacao
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 traz ' + U(0x2019) + 'nao sei' + U(0x2019) + ' no texto')), 'A');
  // controle: o par aberto e fechado em curvas distintas (as de sempre) segue citacao
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 traz ' + U(0x2018) + 'nao sei' + U(0x2019) + ' e ' + U(0x201c) + 'nao sei' + U(0x201d))), 'A');
  // controle: apostrofo de plural (users') nao abre citacao
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 e os users' + U(0x2019) + ' nao sei se ' + U(0x2019) + 'x' + U(0x2019) + ' vale')), 'empate');
});

test('T4/F7-04: D341: o fecho curvo usado dos dois lados so cita quando e o unico par daquele sinal na linha', () => {
  // 4 na linha: o 1o e o 2o casariam por cima do "nao sei" do juiz
  [0x2019, 0x201d].forEach((c) => {
    assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 ' + U(c) + 'x, nao sei qual e melhor, ' + U(c) + 'y' + U(c) + ' e ' + U(c) + 'z')), 'empate', c.toString(16));
  });
  // controle: o par unico segue citacao
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 traz ' + U(0x2019) + 'nao sei' + U(0x2019) + ' no texto')), 'A');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 traz ' + U(0x201d) + 'nao sei' + U(0x201d) + ' no texto')), 'A');
  // controle: o u2019 que fecha o u2018 segue fechando, mesmo com mais de 2 na linha
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 cita ' + U(0x2018) + 'a' + U(0x2019) + ' e ' + U(0x2018) + 'nao sei' + U(0x2019))), 'A');
  // controle: cada sinal conta sozinho; o par unico de u2019 cita mesmo com 4 u201d na linha
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 ' + U(0x2019) + 'nao sei' + U(0x2019) + ' e ' + U(0x201d) + 'a' + U(0x201d) + ' ' + U(0x201d) + 'b' + U(0x201d))), 'A');
});

test('T4/F7-05: limite conhecido (D340): aspa reta que fecha colada em letra e contracao do juiz tem a mesma forma, e na duvida vale empate', () => {
  // a citacao que fecha colada em letra segue empate
  assert.strictEqual(medicao.votoDoJuiz(vd('A', "A.txt:3 'nao sei'ou")), 'empate');
  // a aspa solta do juiz mais a contracao: o "nao sei" dele nao pode ficar escondido
  assert.strictEqual(medicao.votoDoJuiz(vd('A', "A.txt:3 'ok, nao sei, don't")), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', "A.txt:3 'x e nao sei o que dizer, d'agua")), 'empate');
  // controle: apostrofo de palavra
  assert.strictEqual(medicao.votoDoJuiz(vd('A', "A.txt:3 don't, nao sei")), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('A', "A.txt:3 it's nao sei 'x'")), 'empate');
  // controle: citacao com apostrofo dentro e fecho limpo segue citacao
  assert.strictEqual(medicao.votoDoJuiz(vd('A', "A.txt:2 cita 'don't, nao sei' do texto")), 'A');
});

test('T4/F7-06: aspa reta em numero impar na linha nao forma citacao e nao esconde o "nao sei" do juiz', () => {
  assert.strictEqual(medicao.votoDoJuiz(vd('B', 'B.txt:4 repete "x; nao sei qual e melhor; A.txt:2 repete "y"')), 'empate');
  assert.strictEqual(medicao.votoDoJuiz(vd('B', "B.txt:4 repete 'x; nao sei qual e melhor; A.txt:2 repete 'y'")), 'empate');
  // controle: dois pares completos seguem citacao
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 cita "nao sei" e "ok"')), 'A');
  // controle: a conta e por linha: uma aspa sobrando em outra linha nao desfaz a citacao desta
  assert.strictEqual(medicao.votoDoJuiz(vd('A', 'A.txt:3 usa "x\nB.txt:4 cita "nao sei" aqui')), 'A');
});

test('T4/F7: os abridores novos e a aspa sobrando nao custam tempo quadratico', () => {
  [0x201e, 0x201a, 0x2039, 0x2019, 0x201d, 0x22, 0x27].forEach((codigo) => {
    const t0 = Date.now();
    medicao.votoDoJuiz(vd('A', 'A.txt:1 ' + String.fromCharCode(codigo).repeat(100001)));
    const ms = Date.now() - t0;
    assert.ok(ms < 1000, codigo.toString(16) + ': ' + ms + ' ms em 100001 aspas');
  });
});

/** O claude de mentira com um --require que mexe no CLI; `linhas` vem depois de fs e path. */
function geraComPreload(linhas) {
  const a = ambienteFalso();
  const env = Object.assign(preloadDeFalha(linhas), { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config });
  const r = cli(['--gerar', '--modelo', 'modelo-x', '--destino', path.join(a.dir, 'brinquedos'), '--prompt', 'explicar-1'], { cwd: a.onde, env: env });
  return { a: a, r: r, ger: () => JSON.parse(fs.readFileSync(path.join(achar(a.onde), 'geracoes.json'), 'utf8')) };
}

test('T4/F4-01: --prompt sem valor recusa dizendo isso; prompt que nao existe segue com a mensagem de antes', () => {
  const a = ambienteFalso();
  const env = { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config };
  const destino = path.join(a.dir, 'brinquedos');
  const casos = [
    ['ultimo argumento', ['--gerar', '--modelo', 'modelo-x', '--destino', destino, '--prompt']],
    ['seguido de outra flag', ['--gerar', '--prompt', '--modelo', 'modelo-x', '--destino', destino]]
  ];
  casos.forEach(([nome, args]) => {
    const r = cli(args, { cwd: a.onde, env: env });
    assert.notStrictEqual(r.status, 0, nome);
    assert.ok(/--prompt sem valor\. Passe o id: --prompt <id>\./.test(r.stderr), nome + ': ' + r.stderr);
    assert.ok(!/"null"/.test(r.stderr), nome + ': ' + r.stderr);
    assert.ok(!fs.existsSync(a.log) && !fs.existsSync(destino), nome + ': rodou ou criou pasta');
  });
  const outro = cli(['--gerar', '--modelo', 'modelo-x', '--destino', destino, '--prompt', 'nao-existe'], { cwd: a.onde, env: env });
  assert.notStrictEqual(outro.status, 0);
  assert.ok(/--prompt "nao-existe" nao esta em modelos\/qualidade-prompts\.json/.test(outro.stderr), outro.stderr);
});

test('T4/F4-02: arquivo de prompt que cai em .claude/sworn/ ou .git/ do brinquedo recusa antes de rodar o claude', () => {
  const caixa = process.platform === 'win32';
  const ruins = ['.claude/sworn/projeto.json', '.claude/sworn/escopo.md', '.git/config', './.git/hooks/pre-commit', '.claude/sworn'];
  if (caixa) ruins.push('.GIT/config', '.Claude/Sworn/regras.md', '.claude\\sworn\\regras.md', 'src\\..\\.git\\HEAD');
  else ruins.push('src/../.git/HEAD');
  const bons = ['.claude/outra.md', 'src/.git-nao.txt', '.gitignore', '.claude/sworn-nao/x.md'];
  const rodar = (rel) => {
    const a = ambienteFalso();
    const copia = path.join(a.dir, 'plugin');
    ['scripts', 'modelos'].forEach((d) => fs.cpSync(path.join(RAIZ, d), path.join(copia, d), { recursive: true }));
    const arquivo = path.join(copia, 'modelos', 'qualidade-prompts.json');
    const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    dados.prompts[1].arquivos = { [rel]: 'conteudo' };
    fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2), 'utf8');
    fs.mkdirSync(a.onde, { recursive: true });
    const r = spawnSync(process.execPath, [path.join(copia, 'scripts', 'medir-qualidade.js'), '--gerar', '--modelo', 'modelo-x',
      '--destino', path.join(a.dir, 'brinquedos'), '--prompt', dados.prompts[0].id],
    { cwd: a.onde, encoding: 'utf8', env: Object.assign({}, process.env, { SWORN_CLAUDE: a.fake, FAKE_LOG: a.log, CLAUDE_CONFIG_DIR: a.config }), timeout: 120000 });
    return { r: r, a: a };
  };
  ruins.forEach((rel) => {
    const { r, a } = rodar(rel);
    assert.notStrictEqual(r.status, 0, rel + ': gerou');
    assert.ok(/prompt 2/.test(r.stderr) && /cai em \.claude\/sworn\/ \(ou \.git\/\) do brinquedo, que a medicao grava/.test(r.stderr), rel + ': ' + r.stderr);
    assert.ok(!fs.existsSync(a.log), rel + ': o claude rodou');
  });
  bons.forEach((rel) => {
    const { r } = rodar(rel);
    assert.strictEqual(r.status, 0, rel + ': ' + r.stdout + r.stderr);
  });
});

test('T4/F4-04: leitura da saida que lanca vira motivo da geracao; a geracao se grava e a rodada para', () => {
  const medicaoJs = JSON.stringify(path.join(RAIZ, 'scripts', 'lib', 'medicao.js'));
  [['lerExecucao', /nao li a saida do claude/], ['sessionIdDe', /nao li o session_id/]].forEach(([funcao, motivo]) => {
    const { a, r, ger } = geraComPreload([
      'const m = require(' + medicaoJs + ');',
      'm.' + funcao + " = function () { throw new Error('leitura de mentira'); };"
    ]);
    assert.strictEqual(r.status, 1, funcao + ': ' + r.stdout + r.stderr);
    assert.strictEqual(fs.readFileSync(a.log, 'utf8').trim().split('\n').length, 1, funcao + ': continuou gastando');
    const g = ger();
    assert.strictEqual(g.geracoes.length, 1, funcao + ': a execucao paga sumiu do geracoes.json');
    assert.strictEqual(g.geracoes[0].ok, false, funcao);
    assert.ok(g.geracoes[0].motivos.some((m) => motivo.test(m) && /leitura de mentira/.test(m)), funcao + ': ' + JSON.stringify(g.geracoes[0].motivos));
    assert.strictEqual(g.completo, false, funcao);
    assert.ok(/PAROU/.test(r.stderr), funcao + ': ' + r.stderr);
  });
});

test('T4/F4-05: o geracoes.json que nao grava no fim diz isso, a causa, e que as geracoes ja estao no arquivo', () => {
  const { r, ger } = geraComPreload([
    'const original = fs.writeFileSync;',
    'fs.writeFileSync = function (alvo, dados) {',
    // so a gravacao do fim leva completo: true
    "  if (path.basename(String(alvo)) === 'geracoes.json' && String(dados).indexOf('\"completo\": true') !== -1) { const e = new Error('disco cheio de mentira'); e.code = 'ENOSPC'; throw e; }",
    '  return original.apply(this, arguments);',
    '};'
  ]);
  assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(/nao gravei o geracoes\.json no fim da rodada/.test(r.stderr) && /ENOSPC/.test(r.stderr), r.stderr);
  assert.ok(/ja estao no arquivo/.test(r.stderr) && /completo/.test(r.stderr), r.stderr);
  const g = ger();
  assert.strictEqual(g.geracoes.length, 3, 'as geracoes gravadas uma a uma tem de estar no arquivo');
  assert.strictEqual(g.completo, false);
});

test('T4/F4-06: claude que chegou a rodar e foi parado nao e "nao rodou"; o que nem nasceu (pid 0) segue "nao rodou"', () => {
  const casos = [
    ['nasceu e foi parado', 'EACCES', '', /rodou e foi parado \(EACCES\)/, /nao rodou/],
    // controle: o spawnSync devolve pid 0 para o executavel que nao existe
    ['nao nasceu', 'ENOENT', ' r.pid = 0;', /nao rodou: ENOENT/, /rodou e foi parado/]
  ];
  casos.forEach(([nome, code, pid, deve, naoDeve]) => {
    const { r, ger } = geraComPreload([
      "const cp = require('child_process');",
      'const original = cp.spawnSync;',
      'cp.spawnSync = function (cmd, args) {',
      "  if (!Array.isArray(args) || args.indexOf('-p') === -1) return original.apply(this, arguments);",
      '  const r = original.apply(this, arguments);',
      "  const e = new Error('spawnSync " + code + "'); e.code = '" + code + "';",
      '  r.error = e; r.status = null;' + pid,
      '  return r;',
      '};'
    ]);
    assert.strictEqual(r.status, 1, nome + ': ' + r.stdout + r.stderr);
    const g = ger().geracoes[0];
    assert.strictEqual(g.ok, false, nome);
    assert.ok(g.motivos.some((m) => deve.test(m)), nome + ': ' + JSON.stringify(g.motivos));
    assert.ok(!g.motivos.some((m) => naoDeve.test(m)), nome + ': ' + JSON.stringify(g.motivos));
  });
});

test('T4/F4-07: SWORN_CLAUDE entre aspas ganha a dica de tirar as aspas, e nao e consertado sozinho', () => {
  const a = ambienteFalso();
  [['aspas duplas', '"' + a.fake + '"'], ['aspas simples', "'" + a.fake + "'"]].forEach(([nome, valor]) => {
    const destino = path.join(a.dir, 'brinquedos');
    const r = cli(['--gerar', '--modelo', 'modelo-x', '--destino', destino], { cwd: a.onde, env: { SWORN_CLAUDE: valor, FAKE_LOG: a.log } });
    assert.notStrictEqual(r.status, 0, nome + ': tirou as aspas sozinho');
    assert.ok(/SWORN_CLAUDE/.test(r.stderr) && /tire as aspas do valor/.test(r.stderr), nome + ': ' + r.stderr);
    assert.ok(!fs.existsSync(a.log) && !fs.existsSync(destino), nome);
  });
  // controle: valor sem aspas que nao existe nao leva a dica
  const sem = cli(['--gerar', '--modelo', 'modelo-x', '--destino', path.join(a.dir, 'brinquedos')],
    { cwd: a.onde, env: { SWORN_CLAUDE: path.join(a.dir, 'sumido.js') } });
  assert.notStrictEqual(sem.status, 0);
  assert.ok(!/aspas/.test(sem.stderr), sem.stderr);
});

test('T4/F4-08: a copia da transcricao que nao grava diz que e a prova do caveman e o que conferir; as outras falhas ficam como eram', () => {
  const falha = (funcao, arg, sufixo) => geraComPreload([
    'const original = fs.' + funcao + ';',
    'fs.' + funcao + ' = function () {',
    "  if (String(arguments[" + arg + "]).endsWith('" + sufixo + "')) { const e = new Error('disco cheio de mentira'); e.code = 'ENOSPC'; throw e; }",
    '  return original.apply(this, arguments);',
    '};'
  ]);
  const t = falha('copyFileSync', 1, '.transcricao.jsonl');
  assert.strictEqual(t.r.status, 1, t.r.stdout + t.r.stderr);
  const m = t.ger().geracoes[0].motivos.filter((x) => /transcricao/.test(x))[0] || '';
  assert.ok(/ENOSPC/.test(m) && /prova de que o caveman foi aplicado/.test(m) && /sem ela a geracao nao vale/.test(m), JSON.stringify(m));
  assert.ok(/espaco em disco/.test(m) && /caminho longo/.test(m) && /permissao da pasta da rodada/.test(m), JSON.stringify(m));
  assert.strictEqual(t.ger().geracoes[0].ok, false, 'a parada se mantem (D313 6)');
  // controle: a falha do stream bruto nao ganha o texto da transcricao
  const s = falha('writeFileSync', 0, '.stream.jsonl');
  const ms = s.ger().geracoes[0].motivos.filter((x) => /stream/.test(x))[0] || '';
  assert.ok(/nao gravei o stream bruto \(ENOSPC\)/.test(ms) && !/caveman/.test(ms), JSON.stringify(ms));
});

test('T4/F4-09: montagem com mais de 10 min sai mesmo com o pid vivo; a recente e a de carimbo no futuro ficam', () => {
  const rodada = rodadaDeMentira();
  const agora = Date.now();
  const nomes = {
    velha: 'montagem-' + process.pid + '-' + (agora - 11 * 60 * 1000),
    recente: 'montagem-' + process.pid + '-' + agora,
    futura: 'montagem-' + process.pid + '-' + (agora + 60 * 60 * 1000)
  };
  Object.keys(nomes).forEach((k) => {
    fs.mkdirSync(path.join(rodada, nomes[k]));
    fs.writeFileSync(path.join(rodada, nomes[k], 'mapa.json'), '{}', 'utf8');
  });
  const r = cli(['--pares', rodada]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(!fs.existsSync(path.join(rodada, nomes.velha)), 'a montagem velha, de pid vivo, ficou');
  assert.ok(fs.existsSync(path.join(rodada, nomes.recente, 'mapa.json')), 'apagou a montagem recente de um processo vivo');
  assert.ok(fs.existsSync(path.join(rodada, nomes.futura, 'mapa.json')), 'apagou a montagem de carimbo no futuro (vale a regra do pid)');
});

// ── T10-7: as mensagens dizem o que fazer ────────────────────────────────

test('T10-7/1: apurar com par sem veredito diz o que fazer: julgar os pares (--pares) e apurar de novo (--veredito)', () => {
  const r = apurarCom(geracoes(), []);
  const m = r.motivos.join('\n');
  assert.ok(/julgu/i.test(m), 'falta a acao de julgar: ' + m);
  assert.ok(m.indexOf('--pares') !== -1, 'falta o comando que gera o briefing do juiz: ' + m);
  assert.ok(m.indexOf('--veredito') !== -1, 'falta apurar de novo: ' + m);
  assert.ok(m.indexOf('vereditos/' + medicao.LENTE.chave + '.json') !== -1, 'falta onde o veredito vai: ' + m);
});

test('T10-7/2: o CLI --veredito com par faltando repete a mesma acao do nº 1', () => {
  const rodada = rodadaDeMentira();
  assert.strictEqual(cli(['--pares', rodada]).status, 0);
  fs.readdirSync(path.join(rodada, 'pares')).forEach((p) => { if (p !== 'decisao-9-padrao-2') julgar(rodada, p, 'recurso'); });
  const r = cli(['--veredito', rodada]);
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  const linha = r.stdout.split('\n').find((l) => l.indexOf('VEREDITO: nenhum') === 0) || '';
  assert.ok(/julgu/i.test(linha), 'a linha do veredito nao diz para julgar: ' + r.stdout);
  assert.ok(linha.indexOf('--pares') !== -1 && linha.indexOf('--veredito') !== -1, 'falta o comando: ' + r.stdout);
  assert.ok(r.stdout.indexOf('  falta: decisao-9/padrao/2') !== -1, 'as linhas falta: seguem listando: ' + r.stdout);
});

test('T10-7/3: abertura 0 vez e abertura 2 vezes dizem causas e acoes diferentes', () => {
  const zero = ler({ aberturas: 0 }, 'padrao').motivos.filter((m) => /abertura/.test(m)).join('\n');
  assert.ok(zero, 'sem motivo da abertura');
  assert.ok(/node/.test(zero) && /PATH/.test(zero), 'sem a causa do node fora do PATH: ' + zero);
  assert.ok(/plugin/.test(zero) && /carreg/.test(zero), 'sem a causa do plugin nao carregado: ' + zero);
  assert.ok(!/desligue/i.test(zero), 'o texto do 0 nao pode mandar desligar plugin: ' + zero);
  assert.ok(!/exatamente 1/.test(zero), zero);
  const dupla = ler({ aberturas: 2, bloco: true }, 'recurso').motivos.filter((m) => /abertura/.test(m)).join('\n');
  assert.ok(dupla, 'sem motivo da abertura em dobro');
  assert.ok(/2 vezes/.test(dupla), 'sem a contagem: ' + dupla);
  assert.ok(/duas vezes/.test(dupla) && /marketplace/.test(dupla), 'sem a causa da copia dupla: ' + dupla);
  assert.ok(/desligue/i.test(dupla), 'sem a acao de desligar uma: ' + dupla);
  assert.ok(!/node/.test(dupla) && !/exatamente 1/.test(dupla), dupla);
});

test('T10-7/4: bloco na condicao que nao quer bloco aponta o projeto.json e a chave que desliga', () => {
  const m = ler({ bloco: true }, 'padrao').motivos.filter((x) => /bloco de qualidade apareceu/.test(x)).join('\n');
  assert.ok(m, 'sem o motivo do bloco');
  assert.ok(m.indexOf('padrao') !== -1, m);
  assert.ok(m.indexOf('"qualidadeDeResposta": false') !== -1, 'falta a chave que desliga: ' + m);
  assert.ok(m.indexOf('.claude/sworn/projeto.json') !== -1, 'falta o arquivo: ' + m);
});
