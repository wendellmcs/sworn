'use strict';
// H10c (D884, D889): o roteiro de passos da captura de tela (capturar-tela.js --passos). Aqui, a parte pura
// (scripts/lib/roteiro.js): ler e validar o roteiro, escolher o elemento entre os achados na arvore, o ponto do clique,
// o valor do elemento, os eventos de cada tecla, o nome do elemento com o foco e a soma dos passos. A ponta a ponta, com o navegador de verdade, fica em test/captura.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const roteiro = require('../scripts/lib/roteiro.js');
const captura = require('../scripts/lib/captura.js');

function ler(o) { return roteiro.lerRoteiro(JSON.stringify(o)); }

test('lerRoteiro: os passos validos saem normalizados, com o prazo padrao', function () {
  const r = ler({ passos: [
    { acao: 'digitar', papel: 'textbox', nome: 'E-mail', texto: 'a@b.c' },
    { acao: 'clicar', papel: 'button', nome: 'Entrar', ordem: 2, tempoMax: 9000 },
    { acao: 'esperar', texto: 'Painel' },
    { acao: 'conferir', papel: 'checkbox', nome: 'Aceito', valor: true },
    { acao: 'conferir', papel: 'dialog' },
  ] });
  assert.deepStrictEqual(r, { passos: [
    { acao: 'digitar', papel: 'textbox', nome: 'E-mail', texto: 'a@b.c', tempoMax: roteiro.PRAZO_DO_PASSO },
    { acao: 'clicar', papel: 'button', nome: 'Entrar', ordem: 2, tempoMax: 9000 },
    { acao: 'esperar', texto: 'Painel', tempoMax: roteiro.PRAZO_DO_PASSO },
    { acao: 'conferir', papel: 'checkbox', nome: 'Aceito', valor: 'true', tempoMax: roteiro.PRAZO_DO_PASSO },
    { acao: 'conferir', papel: 'dialog', tempoMax: roteiro.PRAZO_DO_PASSO },
  ] });
  assert.strictEqual(roteiro.PRAZO_DO_PASSO, 5000);
});

test('lerRoteiro: o BOM do Windows no comeco nao estraga o JSON', function () {
  const r = roteiro.lerRoteiro('\uFEFF' + JSON.stringify({ passos: [{ acao: 'esperar', texto: 'x' }] }));
  assert.ok(r.passos, JSON.stringify(r));
});

test('lerRoteiro: cada roteiro errado diz o passo e o que consertar', function () {
  const casos = [
    ['nao e json', /^o roteiro nao e um JSON valido/],
    [JSON.stringify([]), /^o roteiro e um objeto com a lista "passos"/],
    [JSON.stringify({ passos: [] }), /^o roteiro nao tem passos/],
    [JSON.stringify({ passos: [{ acao: 'esperar', texto: 'x' }], extra: 1 }), /^chave desconhecida no roteiro: "extra"/],
    [JSON.stringify({ passos: [1] }), /^passo 1: cada passo e um objeto/],
    [JSON.stringify({ passos: [{ acao: 'arrastar' }] }), /^passo 1: "acao" e clicar, digitar, tecla, esperar ou conferir/],
    [JSON.stringify({ passos: [{ acao: 'tecla' }] }),
      /^passo 1: tecla precisa de "tecla" \(Enter, Escape, Tab, Shift\+Tab, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight\)$/],
    [JSON.stringify({ passos: [{ acao: 'tecla', tecla: 'enter' }] }),
      /^passo 1: "tecla" e uma destas: Enter, Escape, Tab, Shift\+Tab, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight; e veio "enter"$/],
    // o nome herdado de todo objeto nao e uma tecla
    [JSON.stringify({ passos: [{ acao: 'tecla', tecla: 'toString' }] }), /^passo 1: "tecla" e uma destas: .*; e veio "toString"$/],
    [JSON.stringify({ passos: [{ acao: 'tecla', tecla: 13 }] }), /^passo 1: "tecla" e uma destas: .*; e veio 13$/],
    // o nome vale exato: vazio ou com espaco nas pontas nao e uma tecla
    [JSON.stringify({ passos: [{ acao: 'tecla', tecla: '' }] }), /^passo 1: "tecla" e uma destas: .*; e veio ""$/],
    [JSON.stringify({ passos: [{ acao: 'tecla', tecla: ' Enter ' }] }), /^passo 1: "tecla" e uma destas: .*; e veio " Enter "$/],
    // a tecla vai ao elemento com o foco: sem papel, e sem prazo (nada a esperar antes de apertar)
    [JSON.stringify({ passos: [{ acao: 'tecla', tecla: 'Tab', papel: 'button' }] }),
      /^passo 1: chave desconhecida "papel" \(as de tecla: tecla\): a tecla vai ao elemento que tem o foco; para mirar um elemento, ponha antes um passo clicar nele$/],
    [JSON.stringify({ passos: [{ acao: 'tecla', tecla: 'Tab', tempoMax: 900 }] }), /^passo 1: chave desconhecida "tempoMax"/],
    [JSON.stringify({ passos: [{ acao: 'clicar', papel: 'button', nmoe: 'x' }] }), /^passo 1: chave desconhecida "nmoe"/],
    [JSON.stringify({ passos: [{ acao: 'clicar', nome: 'Entrar' }] }), /^passo 1: clicar precisa de "papel"/],
    [JSON.stringify({ passos: [{ acao: 'clicar', papel: 'button', texto: 'x' }] }), /^passo 1: chave desconhecida "texto"/],
    [JSON.stringify({ passos: [{ acao: 'digitar', papel: 'textbox', nome: 'E' }] }), /^passo 1: digitar precisa de "texto"/],
    [JSON.stringify({ passos: [{ acao: 'digitar', papel: 'textbox', texto: '' }] }), /^passo 1: "texto" vazio/],
    [JSON.stringify({ passos: [{ acao: 'conferir' }] }), /^passo 1: conferir precisa de "papel" \(o elemento\) ou de "texto"/],
    [JSON.stringify({ passos: [{ acao: 'conferir', papel: 'heading', texto: 'x' }] }), /^passo 1: conferir usa "papel" ou "texto", nao os dois/],
    [JSON.stringify({ passos: [{ acao: 'conferir', texto: 'x', nome: 'y' }] }),
      /^passo 1: "nome" so vale\(m\) com "papel": tire essa\(s\) chave\(s\), ou troque "texto" por "papel"$/],
    [JSON.stringify({ passos: [{ acao: 'esperar', texto: 'x', valor: 1, ordem: 2 }] }), /^passo 1: "valor", "ordem" so vale\(m\)/],
    [JSON.stringify({ passos: [{ papel: 'button' }] }), /^passo 1: falta "acao" \(clicar, digitar, tecla, esperar ou conferir\)$/],
    [JSON.stringify({ passos: [{ acao: null }] }), /^passo 1: "acao" e clicar, digitar, tecla, esperar ou conferir, e veio null$/],
    // a chave que o passo precisa so pede o texto; so a opcional (o nome) pode sair
    [JSON.stringify({ passos: [{ acao: 'clicar', papel: ' ' }] }), /^passo 1: "papel" vazio: escreva o papel$/],
    [JSON.stringify({ passos: [{ acao: 'digitar', papel: 'textbox', texto: ' ' }] }), /^passo 1: "texto" vazio: escreva o texto$/],
    [JSON.stringify({ passos: [{ acao: 'clicar', papel: 'button', nome: '' }] }), /^passo 1: "nome" vazio: tire a chave ou escreva o nome$/],
    [JSON.stringify({ passos: [{ acao: 'clicar', papel: 'button', nome: '   ' }] }), /^passo 1: "nome" vazio: tire a chave ou escreva o nome$/],
    [JSON.stringify({ passos: [{ acao: 'clicar', papel: 'button', ordem: 0 }] }), /^passo 1: "ordem" e um numero inteiro de 1 a 1000/],
    [JSON.stringify({ passos: [{ acao: 'clicar', papel: 'button', ordem: -1 }] }), /^passo 1: "ordem" e um numero inteiro de 1 a 1000, e veio -1$/],
    [JSON.stringify({ passos: [{ acao: 'clicar', papel: 'button', ordem: 1001 }] }), /^passo 1: "ordem" e um numero inteiro de 1 a 1000, e veio 1001$/],
    [JSON.stringify({ passos: [{ acao: 'clicar', papel: 'button', ordem: 1.5 }] }), /^passo 1: "ordem" e um numero inteiro/],
    [JSON.stringify({ passos: [{ acao: 'clicar', papel: 'button', tempoMax: 0 }] }), /^passo 1: "tempoMax" e um numero inteiro de 1 a 600000/],
    [JSON.stringify({ passos: [{ acao: 'clicar', papel: 'button', tempoMax: 600001 }] }),
      /^passo 1: "tempoMax" e um numero inteiro de 1 a 600000 \(em milissegundos: 5000 e 5 s\), e veio 600001$/],
    [JSON.stringify({ passos: [{ acao: 'clicar', papel: 'button', tempoMax: '5000' }] }), /^passo 1: "tempoMax" e um numero inteiro/],
    [JSON.stringify({ passos: [{ acao: 'conferir', papel: 'textbox', valor: null }] }), /^passo 1: "valor" e um texto ou true\/false/],
    [JSON.stringify({ passos: [{ acao: 'conferir', papel: 'spinbutton', valor: 1.5 }] }),
      /^passo 1: "valor" 1\.5 vai entre aspas, como o campo o mostra \(por exemplo "1\.50"\): o numero do JSON perde a forma escrita/],
    // o 1.0 e o 0 chegam inteiros do JSON: a forma escrita ja se perdeu, entao todo numero vai entre aspas
    [JSON.stringify({ passos: [{ acao: 'conferir', papel: 'spinbutton', valor: 1 }] }), /^passo 1: "valor" 1 vai entre aspas/],
    ['{ "passos": [{ "acao": "conferir", "papel": "spinbutton", "valor": 1.0 }] }', /^passo 1: "valor" 1 vai entre aspas/],
    [JSON.stringify({ passos: [{ acao: 'conferir', papel: 'spinbutton', valor: 0 }] }), /^passo 1: "valor" 0 vai entre aspas/],
    [JSON.stringify({ passos: [{ acao: 'conferir', papel: 'spinbutton', valor: 1e21 }] }), /^passo 1: "valor" 1e\+21 vai entre aspas/],
    [JSON.stringify({ passos: [{ acao: 'conferir', papel: 'textbox', valor: {} }] }), /^passo 1: "valor" e um texto ou true\/false/],
    [JSON.stringify({ passos: [{ acao: 'conferir', papel: 'textbox', valor: ['a'] }] }), /^passo 1: "valor" e um texto ou true\/false/],
    [JSON.stringify({ passos: [{ acao: 'clicar', papel: 7 }] }), /^passo 1: "papel" e um texto/],
    [JSON.stringify({ passos: [{ acao: 'esperar', texto: 'x' }, { acao: 'clicar' }] }), /^passo 2: clicar precisa de "papel"/],
  ];
  for (const [texto, esperado] of casos) {
    const r = roteiro.lerRoteiro(texto);
    assert.ok(r.erro, 'sem erro para ' + texto);
    assert.match(r.erro, esperado, texto);
  }
});

test('lerRoteiro: a tecla sai so com o nome dela, sem prazo', function () {
  assert.deepStrictEqual(ler({ passos: [{ acao: 'tecla', tecla: 'Enter' }, { acao: 'tecla', tecla: 'Shift+Tab' }] }),
    { passos: [{ acao: 'tecla', tecla: 'Enter' }, { acao: 'tecla', tecla: 'Shift+Tab' }] });
  assert.ok(Object.keys(roteiro.TECLAS).length > 0);
  for (const nome of Object.keys(roteiro.TECLAS)) assert.ok(ler({ passos: [{ acao: 'tecla', tecla: nome }] }).passos, nome);
});

test('eventosDaTecla: o descer e o subir da tecla, como o protocolo do navegador os quer', function () {
  // o Enter e o espaco escrevem um texto: e ele que faz o botao com o foco receber o clique, como numa pessoa
  assert.deepStrictEqual(roteiro.eventosDaTecla('Enter'), [
    { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 0,
      text: '\r', unmodifiedText: '\r' },
    { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 0 },
  ]);
  assert.deepStrictEqual(roteiro.eventosDaTecla('Space')[0], { type: 'keyDown', key: ' ', code: 'Space',
    windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, modifiers: 0, text: ' ', unmodifiedText: ' ' });
  // a que nao escreve desce sem texto; o Shift vai no modificador (8) dos dois eventos
  assert.deepStrictEqual(roteiro.eventosDaTecla('Shift+Tab'), [
    { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 8 },
    { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 8 },
  ]);
  assert.deepStrictEqual(roteiro.eventosDaTecla('Escape')[0], { type: 'rawKeyDown', key: 'Escape', code: 'Escape',
    windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27, modifiers: 0 });
  assert.strictEqual(roteiro.eventosDaTecla('ArrowDown')[0].windowsVirtualKeyCode, 40);
  // fora da tabela (o roteiro lido ja barra; quem chama direto recebe o erro com a lista, nunca um evento sem tecla)
  for (const nome of ['enter', '', undefined, 'constructor']) {
    assert.throws(function () { roteiro.eventosDaTecla(nome); }, /^Error: tecla desconhecida: .*; as que valem: Enter, Escape, Tab,/,
      String(nome));
  }
});

test('focoDoNo: onde o foco caiu, como a arvore o chama', function () {
  assert.strictEqual(roteiro.focoDoNo({ role: { value: 'button' }, name: { value: 'Entrar' } }), 'button "Entrar"');
  assert.strictEqual(roteiro.focoDoNo({ role: { value: 'dialog' }, name: { value: '' } }), 'dialog');
  for (const no of [null, undefined, { ignored: true, role: { value: 'generic' } }, {}]) {
    assert.strictEqual(roteiro.focoDoNo(no), 'nenhum elemento: o foco esta no corpo da pagina', JSON.stringify(no));
  }
});

test('lerRoteiro: o nome sai sem espaco nas pontas (a arvore o da assim), o meio fica', function () {
  assert.strictEqual(ler({ passos: [{ acao: 'clicar', papel: ' button ', nome: '  Entrar  agora ' }] }).passos[0].nome,
    'Entrar  agora');
});

test('lerRoteiro: as pontas aceitas da ordem, do tempoMax e do valor', function () {
  const um = function (extra) { return ler({ passos: [Object.assign({ acao: 'clicar', papel: 'button' }, extra)] }).passos[0]; };
  assert.strictEqual(um({ ordem: 1000 }).ordem, 1000);
  assert.strictEqual(um({ tempoMax: 600000 }).tempoMax, 600000);
  const valor = function (v) { return ler({ passos: [{ acao: 'conferir', papel: 'textbox', valor: v }] }).passos[0].valor; };
  // a caixa desmarcada e o campo vazio sao valores, nao a falta deles
  assert.strictEqual(valor(false), 'false');
  assert.strictEqual(valor(''), '');
  assert.strictEqual(valor('1.50'), '1.50');
});

test('ondeQuebrou: o JSON quebrado diz a linha e a coluna, ou que o arquivo acaba antes', function () {
  assert.match(roteiro.lerRoteiro('{\n"passos" []}').erro,
    /^o roteiro nao e um JSON valido \(perto da linha 2, coluna 10: confira virgulas, aspas e chaves ali\)/);
  // a mensagem do Node antigo, sem linha e coluna: contadas da posicao do mesmo jeito
  assert.strictEqual(roteiro.ondeQuebrou('Unexpected token ] in JSON at position 8', '{\n"a":1,]}'),
    'perto da linha 2, coluna 7: confira virgulas, aspas e chaves ali');
  assert.match(roteiro.lerRoteiro('{"passos":').erro, /\(o arquivo acaba antes de fechar: confira se falta \} ou \] no fim\)/);
  // sem posicao na mensagem do motor: o caractere que ele nao esperava, quando ela o diz
  assert.match(roteiro.lerRoteiro('x').erro,
    /^o roteiro nao e um JSON valido \(o caractere "x" nao cabe ali: confira virgulas, aspas e chaves; um texto sem aspas, por exemplo\)/);
  assert.strictEqual(roteiro.ondeQuebrou('Bad JSON', '?'), 'confira virgulas, aspas e chaves');
  // a mensagem em ingles do motor nao chega a pessoa
  assert.doesNotMatch(roteiro.lerRoteiro('x').erro, /Unexpected|valid JSON/);
});

test('falhaAoLer: cada falha de leitura diz o que fazer', function () {
  assert.strictEqual(roteiro.falhaAoLer('"r.json"', { code: 'ENOENT' }), '--passos: "r.json" nao existe: confira o caminho do roteiro');
  assert.strictEqual(roteiro.falhaAoLer('"r.json"', { code: 'EACCES' }),
    '--passos: sem permissao para ler "r.json": libere a leitura do arquivo, ou copie-o para uma pasta sua');
  assert.match(roteiro.falhaAoLer('"r.json"', { code: 'EPERM' }), /sem permissao/);
  const fechar = ': feche o programa que estiver com ele aberto e capture de novo';
  assert.strictEqual(roteiro.falhaAoLer('"r.json"', { code: 'EBUSY' }), '--passos: nao deu para ler "r.json" (EBUSY)' + fechar);
  assert.strictEqual(roteiro.falhaAoLer('"r.json"', new Error('quebrou')), '--passos: nao deu para ler "r.json" (quebrou)' + fechar);
});

test('lerRoteiro: o teto de passos e o dos textos', function () {
  const um = { acao: 'esperar', texto: 'x' };
  assert.ok(ler({ passos: Array(roteiro.TETO_DE_PASSOS).fill(um) }).passos);
  assert.match(ler({ passos: Array(roteiro.TETO_DE_PASSOS + 1).fill(um) }).erro,
    new RegExp('^o roteiro tem ' + (roteiro.TETO_DE_PASSOS + 1) + ' passos, e o maximo e ' + roteiro.TETO_DE_PASSOS));
  const longo = 'a'.repeat(roteiro.TETO_DO_TEXTO + 1);
  assert.ok(ler({ passos: [{ acao: 'digitar', papel: 'textbox', texto: 'a'.repeat(roteiro.TETO_DO_TEXTO) }] }).passos);
  assert.match(ler({ passos: [{ acao: 'digitar', papel: 'textbox', texto: longo }] }).erro,
    new RegExp('^passo 1: "texto" passa de ' + roteiro.TETO_DO_TEXTO + ' caracteres'));
  assert.match(ler({ passos: [{ acao: 'clicar', papel: 'button', nome: longo }] }).erro, /^passo 1: "nome" passa de/);
  // o teto conta caracteres: o emoji (dois codigos UTF-16) conta um
  const emoji = '\u{1F600}';
  assert.ok(ler({ passos: [{ acao: 'digitar', papel: 'textbox', texto: emoji.repeat(roteiro.TETO_DO_TEXTO) }] }).passos);
  assert.match(ler({ passos: [{ acao: 'digitar', papel: 'textbox', texto: emoji.repeat(roteiro.TETO_DO_TEXTO + 1) }] }).erro,
    /^passo 1: "texto" passa de/);
  assert.ok(ler({ passos: [{ acao: 'conferir', papel: 'textbox', valor: emoji.repeat(roteiro.TETO_DO_TEXTO) }] }).passos);
  assert.match(ler({ passos: [{ acao: 'conferir', papel: 'textbox', valor: emoji.repeat(roteiro.TETO_DO_TEXTO + 1) }] }).erro,
    /^passo 1: "valor" passa de/);
});

test('lerArquivoDoRoteiro: le o arquivo, devolve o hash dele e diz o que fazer quando nao da', function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-roteiro-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  const arquivo = path.join(dir, 'roteiro.json');
  const texto = JSON.stringify({ passos: [{ acao: 'esperar', texto: 'x' }] });
  fs.writeFileSync(arquivo, texto);
  const r = roteiro.lerArquivoDoRoteiro(arquivo);
  assert.deepStrictEqual(r, { passos: [{ acao: 'esperar', texto: 'x', tempoMax: roteiro.PRAZO_DO_PASSO }],
    sha256: crypto.createHash('sha256').update(Buffer.from(texto)).digest('hex') });
  assert.match(roteiro.lerArquivoDoRoteiro(path.join(dir, 'nao-existe.json')).erro,
    /^--passos: ".*nao-existe\.json" nao existe: confira o caminho do roteiro$/);
  assert.match(roteiro.lerArquivoDoRoteiro(dir).erro, /^--passos: ".*" e uma pasta, nao um arquivo/);
  assert.strictEqual(roteiro.lerArquivoDoRoteiro(undefined).erro, '--passos sem caminho: diga o caminho do roteiro.json');
  assert.strictEqual(roteiro.lerArquivoDoRoteiro('').erro, '--passos sem caminho: diga o caminho do roteiro.json');
  // o `>` do PowerShell 5 grava UTF-16 LE com a marca: o roteiro vale, e o hash e dos bytes do arquivo
  const u16 = path.join(dir, 'u16.json');
  const bytes16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(texto, 'utf16le')]);
  fs.writeFileSync(u16, bytes16);
  assert.deepStrictEqual(roteiro.lerArquivoDoRoteiro(u16), { passos: [{ acao: 'esperar', texto: 'x', tempoMax: roteiro.PRAZO_DO_PASSO }],
    sha256: crypto.createHash('sha256').update(bytes16).digest('hex') });
  fs.writeFileSync(u16, Buffer.concat([Buffer.from([0xFE, 0xFF]), Buffer.from(texto, 'utf16le').swap16()]));
  assert.match(roteiro.lerArquivoDoRoteiro(u16).erro, /^--passos: o roteiro esta em UTF-16 BE: salve-o em UTF-8/);
  const grande = path.join(dir, 'grande.json');
  fs.writeFileSync(grande, Buffer.alloc(roteiro.TETO_DO_ARQUIVO + 1, 0x20));
  assert.match(roteiro.lerArquivoDoRoteiro(grande).erro, /^--passos: o roteiro passa de 1 MB/);
  // no teto exato o tamanho passa (o que sobra e so espaco, entao o erro e o do vazio, nao o do tamanho)
  fs.writeFileSync(grande, Buffer.alloc(roteiro.TETO_DO_ARQUIVO, 0x20));
  assert.match(roteiro.lerArquivoDoRoteiro(grande).erro, /^--passos: o roteiro esta vazio/);
  fs.writeFileSync(arquivo, '{');
  assert.match(roteiro.lerArquivoDoRoteiro(arquivo).erro, /^--passos: o roteiro nao e um JSON valido/);
  // o arquivo vazio (o New-Item, ou o `>` que falhou), o so de espacos e o so com a marca dizem que esta vazio
  for (const conteudo of ['', '  \n ', '\uFEFF']) {
    fs.writeFileSync(arquivo, conteudo);
    assert.match(roteiro.lerArquivoDoRoteiro(arquivo).erro, /^--passos: o roteiro esta vazio: escreva nele a lista de passos \(exemplo:/,
      JSON.stringify(conteudo));
  }
  // o caminho com espaco e acento aparece inteiro, entre aspas
  const comEspaco = path.join(dir, 'João Silva');
  fs.mkdirSync(comEspaco);
  const nele = path.join(comEspaco, 'roteiro.json');
  fs.writeFileSync(nele, texto);
  assert.ok(roteiro.lerArquivoDoRoteiro(nele).passos);
  assert.strictEqual(roteiro.lerArquivoDoRoteiro(path.join(comEspaco, 'falta.json')).erro,
    '--passos: "' + path.join(comEspaco, 'falta.json') + '" nao existe: confira o caminho do roteiro');
});

const no = function (nome, extra) { return Object.assign({ role: { value: 'button' }, name: { value: nome } }, extra); };

test('escolherNo: um so, o da ordem, nenhum ou mais de um sem ordem', function () {
  // os dois casam o passo; o backendDOMNodeId distingue qual saiu (iguais por valor, o deepStrictEqual nao veria)
  const a = no('Entrar', { backendDOMNodeId: 1 });
  const b = no('Entrar', { backendDOMNodeId: 2 });
  assert.deepStrictEqual(roteiro.escolherNo([a], { papel: 'button', nome: 'Entrar' }), { no: a });
  assert.deepStrictEqual(roteiro.escolherNo([a, b], { papel: 'button', nome: 'Entrar', ordem: 2 }), { no: b });
  assert.deepStrictEqual(roteiro.escolherNo([], { papel: 'button', nome: 'Entrar' }),
    { motivo: 'nenhum elemento com esse papel e nome na arvore de acessibilidade: os papeis e nomes que a pagina tem ' +
      'estao em "acessibilidade" do evidencia.json' });
  assert.deepStrictEqual(roteiro.escolherNo([a, b], { papel: 'button', nome: 'Entrar' }),
    { motivo: '2 elementos com esse papel e nome na pagina: diga qual com "ordem" (de 1 a 2)' });
  assert.deepStrictEqual(roteiro.escolherNo([a], { papel: 'button', nome: 'Entrar', ordem: 3 }),
    { motivo: 'so 1 elemento(s) com esse papel e nome na pagina, e o passo pede o de ordem 3' });
  assert.match(roteiro.escolherNo([], { papel: 'dialog' }).motivo,
    /^nenhum elemento com esse papel na arvore de acessibilidade: /);
  // o motivo nunca leva o alvo: ele vai em campo proprio do rastro, limpo de segredo sozinho
  assert.doesNotMatch(roteiro.escolherNo([], { papel: 'button', nome: 'token=abc123def456' }).motivo, /abc123/);
});

test('valorDoNo, desabilitado, soLeitura e editavel leem o no da arvore', function () {
  // os tipos que a arvore da: checked e tristate, disabled e readonly sao booleanos, editable e um token
  const prop = function (nome, valor) {
    const tipo = nome === 'checked' ? 'tristate' : typeof valor === 'boolean' ? 'boolean' : 'token';
    return { name: nome, value: { type: tipo, value: valor } };
  };
  assert.strictEqual(roteiro.valorDoNo({ value: { type: 'string', value: 'x' } }), 'x');
  assert.strictEqual(roteiro.valorDoNo({ value: { type: 'string', value: 'x' }, properties: [prop('checked', 'true')] }), 'true');
  assert.strictEqual(roteiro.valorDoNo({ properties: [prop('checked', 'false')] }), 'false');
  assert.strictEqual(roteiro.valorDoNo({ value: { type: 'number', value: 3 } }), '3');
  assert.strictEqual(roteiro.valorDoNo({}), '');
  assert.strictEqual(roteiro.desabilitado({ properties: [prop('disabled', true)] }), true);
  assert.strictEqual(roteiro.desabilitado({ properties: [prop('focusable', true)] }), false);
  assert.strictEqual(roteiro.desabilitado({}), false);
  assert.strictEqual(roteiro.soLeitura({ properties: [prop('readonly', true)] }), true);
  assert.strictEqual(roteiro.soLeitura({ properties: [prop('readonly', false)] }), false);
  assert.strictEqual(roteiro.editavel({ properties: [prop('editable', 'plaintext')] }), true);
  assert.strictEqual(roteiro.editavel({ properties: [prop('editable', 'richtext')] }), true);
  assert.strictEqual(roteiro.editavel({ properties: [prop('focusable', true)] }), false);
});

test('pontoDoClique: o centro da parte visivel do primeiro quadro com area', function () {
  // quadro de 100x40 em (10,20)
  const q = [10, 20, 110, 20, 110, 60, 10, 60];
  assert.deepStrictEqual(roteiro.pontoDoClique([q], 1280, 800), { x: 60, y: 40 });
  // o primeiro sem area fica de fora
  assert.deepStrictEqual(roteiro.pontoDoClique([[5, 5, 5, 5, 5, 5, 5, 5], q], 1280, 800), { x: 60, y: 40 });
  // maior que a janela: o centro da parte dentro dela
  assert.deepStrictEqual(roteiro.pontoDoClique([[0, -100, 200, -100, 200, 1000, 0, 1000]], 1280, 800), { x: 100, y: 400 });
  // saindo pela esquerda e pela direita: o centro da parte dentro da janela
  assert.deepStrictEqual(roteiro.pontoDoClique([[-100, 0, 100, 0, 100, 10, -100, 10]], 1280, 800), { x: 50, y: 5 });
  assert.deepStrictEqual(roteiro.pontoDoClique([[1200, 0, 1400, 0, 1400, 10, 1200, 10]], 1280, 800), { x: 1240, y: 5 });
  // fora da janela, sem quadro ou torto
  assert.strictEqual(roteiro.pontoDoClique([[0, 900, 10, 900, 10, 950, 0, 950]], 1280, 800), null);
  assert.strictEqual(roteiro.pontoDoClique([], 1280, 800), null);
  assert.strictEqual(roteiro.pontoDoClique(undefined, 1280, 800), null);
  assert.strictEqual(roteiro.pontoDoClique([[1, 2, 3]], 1280, 800), null);
});

test('descrever: o alvo do passo como a pessoa le', function () {
  assert.strictEqual(roteiro.descrever({ acao: 'clicar', papel: 'button', nome: 'Entrar' }), 'clicar button "Entrar"');
  assert.strictEqual(roteiro.descrever({ acao: 'conferir', papel: 'dialog' }), 'conferir dialog');
  assert.strictEqual(roteiro.descrever({ acao: 'esperar', texto: 'Painel' }), 'esperar o texto "Painel"');
  assert.strictEqual(roteiro.descrever({ acao: 'conferir', papel: 'textbox', nome: 'E', valor: 'x' }),
    'conferir textbox "E" com o valor "x"');
  assert.strictEqual(roteiro.descrever({ acao: 'tecla', tecla: 'Shift+Tab' }), 'tecla Shift+Tab');
});

test('somarPassos: a conta do roteiro inteiro, por script', function () {
  const ok = function (n, acao) { return { n, acao, ok: true }; };
  const falha = function (n, acao) { return { n, acao, ok: false, motivo: 'x' }; };
  assert.deepStrictEqual(roteiro.somarPassos([ok(1, 'clicar'), ok(2, 'conferir'), falha(3, 'conferir'), ok(4, 'conferir')], 4),
    { ok: false, total: 4, rodados: 4, conferencias: 3, conferenciasOk: 2, conferenciasFalhas: [3], parouNo: null });
  assert.deepStrictEqual(roteiro.somarPassos([ok(1, 'clicar'), falha(2, 'esperar')], 5),
    { ok: false, total: 5, rodados: 2, conferencias: 0, conferenciasOk: 0, conferenciasFalhas: [], parouNo: 2 });
  assert.deepStrictEqual(roteiro.somarPassos([ok(1, 'digitar'), ok(2, 'conferir')], 2),
    { ok: true, total: 2, rodados: 2, conferencias: 1, conferenciasOk: 1, conferenciasFalhas: [], parouNo: null });
  // um passo que nao rodou sem que nenhum tenha parado o roteiro nao conta como ok (defesa: o rodarRoteiro do
  // capturar-tela.js grava todo passo que roda e so sai do laco depois de um que parou)
  assert.strictEqual(roteiro.somarPassos([ok(1, 'clicar')], 2).ok, false);
});

test('avisoDoRoteiro: o passo que parou e as conferencias que falharam, com onde ler', function () {
  const rastro = [{ n: 1, acao: 'clicar', papel: 'button', nome: 'Entrar', ok: false, motivo: 'nenhum button "Entrar"' }];
  assert.strictEqual(roteiro.avisoDoRoteiro(roteiro.somarPassos(rastro, 3), rastro),
    'o roteiro parou no passo 1 (clicar button "Entrar"): nenhum button "Entrar"; os 2 passo(s) seguinte(s) nao ' +
    'rodaram, e a foto mostra a pagina nesse ponto; o rastro de cada passo esta em roteiro.passos do evidencia.json');
  // o alvo vem do roteiro e vai a saida limpo de segredo, como no disco (mesmo depois de aspa, pendencia #19)
  const comSegredo = [{ n: 1, acao: 'esperar', papel: 'textbox', nome: 'token=abc123def456', ok: false, motivo: 'm' }];
  const avisoComSegredo = roteiro.avisoDoRoteiro(roteiro.somarPassos(comSegredo, 1), comSegredo);
  assert.doesNotMatch(avisoComSegredo, /abc123def456/);
  assert.match(avisoComSegredo, /^o roteiro parou no passo 1 \(esperar textbox "token=\[segredo\]"\): m;/);
  // na conferencia que falha, o valor esperado tambem sai limpo (o aviso cita o passo pelo numero, e o rastro o leva)
  const confSegredo = [{ n: 1, acao: 'conferir', papel: 'textbox', valor: 'token=abc123def456', ok: false, motivo: 'm' }];
  assert.doesNotMatch(roteiro.avisoDoRoteiro(roteiro.somarPassos(confSegredo, 1), confSegredo), /abc123def456/);
  assert.doesNotMatch(JSON.stringify(roteiro.rastroParaODisco(confSegredo)), /abc123def456/);
  const conf = [{ n: 1, acao: 'conferir', texto: 'a', ok: false, motivo: 'm' }, { n: 2, acao: 'conferir', texto: 'b', ok: true },
    { n: 3, acao: 'conferir', texto: 'c', ok: false, motivo: 'm' }];
  assert.strictEqual(roteiro.avisoDoRoteiro(roteiro.somarPassos(conf, 3), conf),
    '2 de 3 conferencia(s) falharam (passo(s) 1, 3): o esperado e o obtido de cada uma estao em roteiro.passos do ' +
    'evidencia.json');
  const tudo = [{ n: 1, acao: 'conferir', texto: 'a', ok: true }];
  assert.strictEqual(roteiro.avisoDoRoteiro(roteiro.somarPassos(tudo, 1), tudo), '');
  // o passo que parou o roteiro no ultimo lugar nao fala de passos seguintes
  const ultimo = [{ n: 1, acao: 'esperar', texto: 'z', ok: false, motivo: 'm' }];
  assert.strictEqual(roteiro.avisoDoRoteiro(roteiro.somarPassos(ultimo, 1), ultimo),
    'o roteiro parou no passo 1 (esperar o texto "z"): m; a foto mostra a pagina nesse ponto; o rastro de cada passo ' +
    'esta em roteiro.passos do evidencia.json');
});

test('rastroParaODisco: o texto da pagina e do roteiro vai limpo de segredo e cortado; o digitado nunca vai', function () {
  const rastro = [
    { n: 1, acao: 'digitar', papel: 'textbox', nome: 'Senha', texto: 'segredo123', ok: true, ms: 5, caracteres: 10 },
    { n: 2, acao: 'conferir', papel: 'textbox', nome: 'Busca', valor: 'x', ok: false, ms: 9,
      motivo: 'o valor do elemento nao e o esperado', obtido: 'token=abc123def456' },
  ];
  const disco = roteiro.rastroParaODisco(rastro);
  assert.strictEqual(disco[0].texto, undefined, 'o texto digitado nao vai ao disco');
  assert.strictEqual(disco[0].caracteres, 10);
  assert.doesNotMatch(JSON.stringify(disco), /abc123def456/);
  assert.doesNotMatch(JSON.stringify(disco), /segredo123/);
  assert.strictEqual(disco[1].valor, 'x');
  const longo = roteiro.rastroParaODisco([{ n: 1, acao: 'conferir', texto: 'a', ok: false, obtido: 'b'.repeat(2000) }]);
  // cortado no teto do disco (o TEXTO_MAXIMO da captura, mais a marca do corte), nunca esvaziado
  assert.ok(longo[0].obtido.startsWith('b'.repeat(captura.TEXTO_MAXIMO)), 'o comeco do valor sumiu: ' + longo[0].obtido.slice(0, 20));
  assert.ok(longo[0].obtido.length <= captura.TEXTO_MAXIMO + 3, 'nao cortado no teto do disco: ' + longo[0].obtido.length);
  // o rastro de origem nao muda
  assert.strictEqual(rastro[0].texto, 'segredo123');
});
