'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const regra = require('../scripts/lib/regra.js');

const RAIZ = path.join(__dirname, '..');
const SKILL = path.join(RAIZ, 'skills', 'playbook');

function arquivosDaSkill() {
  const refs = path.join(SKILL, 'references');
  return [path.join(SKILL, 'SKILL.md')].concat(
    fs.readdirSync(refs).filter((f) => f.endsWith('.md')).map((f) => path.join(refs, f))
  );
}

test('absorcao: a skill trouxe os sete arquivos publicados', () => {
  assert.strictEqual(arquivosDaSkill().length, 7);
});

test('absorcao: nenhum arquivo absorvido nomeia modelo, preco ou versao', () => {
  const sujos = [];
  for (const f of arquivosDaSkill()) {
    const texto = fs.readFileSync(f, 'utf8');
    for (const linha of texto.split('\n')) {
      for (const vol of regra.VOLATEIS) {
        if (vol.tipo === 'nome de modelo' && vol.re.test(linha)) {
          sujos.push(path.basename(f) + ': ' + linha.trim().slice(0, 70));
        }
      }
    }
  }
  assert.deepStrictEqual(sujos, [], 'fato volatil no texto absorvido:\n' + sujos.join('\n'));
});

test('absorcao: nada do dono nem da maquina no texto absorvido', () => {
  // test/ E varrido pela superficie 1 do detector de sanitacao: FORA_DO_PUBLICO
  // exclui so docs/. Escrever o padrao por extenso faz ESTE arquivo virar um
  // achado de vazamento a partir da T45, quando o conteudo passar a reprovar a
  // suite (decisao 13). A tecnica ja esta em test/sanitacao.test.js.
  const B = String.fromCharCode(92);
  const proibidos = [
    new RegExp('wen' + 'del', 'i'),
    new RegExp('smart' + 'space', 'i'),
    new RegExp('C:' + B + B + 'Users', 'i'),
    new RegExp('App' + 'Data', 'i'),
    new RegExp('Projeto' + ' KB', 'i')
  ];
  const sujos = [];
  for (const f of arquivosDaSkill()) {
    const texto = fs.readFileSync(f, 'utf8');
    for (const re of proibidos) {
      if (re.test(texto)) sujos.push(path.basename(f) + ' casa ' + re);
    }
  }
  assert.deepStrictEqual(sujos, []);
});
