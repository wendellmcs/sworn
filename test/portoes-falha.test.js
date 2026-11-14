'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * F5b (diagnostico de 2026-11-10, secao F: "50 catch que viram null/false"): todo catch de um portao diz para que
 * lado ele falha. O catch de contador ou de marca (D420: o contador nunca muda a decisao) se reconhece pela chamada
 * na propria linha do catch, sem `return` nela; o de decisao leva `fail-open` (o erro libera, e o comentario diz por
 * que pode) ou `fail-closed` (o erro nega, ou trata a entrada pelo lado que exige a conferencia), na linha do catch,
 * na de cima ou na de baixo - a vizinha que e outro catch nao empresta a marca dela.
 */

const RAIZ = path.join(__dirname, '..');
const SECUNDARIO = /estado\.incrementar|estado\.alterar|contadorNaoGravou|\.contar\(|contarFecho\(|\bmarcar\(/;
const MARCA = /fail-(?:open|closed)/;
// `catch (e)` e o `catch {` sem parametro (ES2019)
const CATCH = /\bcatch\s*[({]/;

function semMarca(nome, fonte) {
  const sem = [];
  const linhas = fonte.split(/\r?\n/);
  linhas.forEach(function (linha, i) {
    if (!CATCH.test(linha)) return;
    // o `return` que decide e o do corpo do catch, depois dele; o do callback do estado.alterar vem antes
    if (SECUNDARIO.test(linha) && !/\breturn\b/.test(linha.slice(linha.search(CATCH)))) return;
    const vizinhas = [linhas[i - 1], linhas[i + 1]].filter(function (l) { return l && !CATCH.test(l); });
    if (MARCA.test([linha].concat(vizinhas).join('\n'))) return;
    sem.push(nome + ':' + (i + 1) + ': ' + linha.trim().slice(0, 90));
  });
  return sem;
}

test('F5b: todo catch dos portoes e de contador ou diz fail-open / fail-closed', () => {
  const portoes = fs.readdirSync(path.join(RAIZ, 'scripts')).filter(function (n) { return /^portao-.*\.js$/.test(n); });
  assert.ok(portoes.length >= 10, 'esperava pelo menos 10 scripts/portao-*.js; achou ' + portoes.length +
    ' (os portoes mudaram de nome ou de pasta? ajuste o filtro deste teste)');
  const sem = [];
  for (const nome of portoes) sem.push.apply(sem, semMarca(nome, fs.readFileSync(path.join(RAIZ, 'scripts', nome), 'utf8')));
  assert.deepStrictEqual(sem, [], 'catch de decisao sem lado: ponha `// fail-open: <por que pode>` ou ' +
    '`// fail-closed: <por que>` na linha do catch, na de cima ou na de baixo');
});

test('F5b: o detector pega o catch sem parametro, o contador que decide e a marca emprestada da vizinha', () => {
  assert.deepStrictEqual(semMarca('x', 'try { a() } catch { return null; }').length, 1, 'catch sem parametro');
  assert.deepStrictEqual(semMarca('x', 'try { a() } catch (e) { estado.incrementar(1); }').length, 0, 'contador puro');
  assert.deepStrictEqual(semMarca('x', 'try { a() } catch (e) { estado.incrementar(1); return true; }').length, 1,
    'contador que tambem decide');
  assert.deepStrictEqual(semMarca('x', 'try { estado.alterar(s, function (x) { return x; }); } catch (_) {}').length, 0,
    'o return do callback, antes do catch, nao e decisao');
  assert.deepStrictEqual(semMarca('x', '} catch (e) { return false; } // fail-closed: x\n} catch (e) { return true; }'),
    ['x:2: } catch (e) { return true; }'], 'a marca do catch de cima nao vale para o de baixo');
  assert.deepStrictEqual(semMarca('x', '// fail-open: o aviso e so texto\n} catch (e) { return null; }').length, 0,
    'marca na linha de cima');
});
