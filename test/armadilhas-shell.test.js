'use strict';
// F3d (D828): as armadilhas do Bash barradas antes de rodar (scripts/lib/armadilhas-shell.js, chamada no
// portao-destrutivo.js depois do idioma de shell): heredoc sem aspas que come a barra, grep -c antes de &&, grep -P no
// Git Bash. H6h (D904): crase nas aspas duplas do node -e, sed -i sem -b, /c/... e /tmp no codigo do node. E a linha
// de situacao ao dono no fim do turno com agente de fundo (saude.linhaDeSituacao).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const armadilhas = require('../scripts/lib/armadilhas-shell.js');
const saude = require('../scripts/lib/saude.js');
const { pasta, rodar } = require('./lib/comum.js');

const tipos = (c, so) => armadilhas.achar(c, 'Bash', so || 'win32').map((a) => a.tipo);

test('F3d: heredoc sem aspas no delimitador com barra dupla ou barra no fim de linha e armadilha', () => {
  assert.deepStrictEqual(tipos('cat > x.js <<EOF\nconst re = /\\\\d+/;\nEOF\nnode x.js'), ['heredoc-barra']);
  assert.deepStrictEqual(tipos('cat > x.txt <<EOF\nlinha um \\\nlinha dois\nEOF'), ['heredoc-barra']);
  assert.deepStrictEqual(tipos('cat <<-FIM\n\tum \\\\ dois\n\tFIM'), ['heredoc-barra'], 'o <<- fecha com tab');
  assert.deepStrictEqual(tipos('cat > x <<  EOF\na\\\\b\nEOF'), ['heredoc-barra'], 'espaco depois do <<');
  // o delimitador com aspas (simples, duplas) ou com barra vai literal: a barra fica
  for (const d of ["'EOF'", '"EOF"', '\\EOF']) {
    assert.deepStrictEqual(tipos('cat > x.js <<' + d + '\nconst re = /\\\\d+/;\nEOF'), [], d);
  }
  // `\$` e escape de proposito, e `\n` o bash deixa como esta: nao e armadilha
  assert.deepStrictEqual(tipos('cat > x.txt <<EOF\npreco \\$5 e \\n\nEOF'), []);
  // sem barra no corpo, sem armadilha; o here-string (<<<) e o << dentro de aspas nao sao heredoc
  assert.deepStrictEqual(tipos('cat > x.txt <<EOF\nsem barra\nEOF'), []);
  assert.deepStrictEqual(tipos('cat <<<"a\\\\b"'), []);
  assert.deepStrictEqual(tipos('cat <<<EOF\na\\\\b\nEOF'), [], 'o <<< com palavra solta');
  assert.deepStrictEqual(tipos('echo "a <<EOF" && echo \\\\'), []);
  // a aspa escapada nao abre texto: o << depois dela e heredoc de verdade
  assert.deepStrictEqual(tipos('echo \\"a <<EOF\na\\\\b\nEOF'), ['heredoc-barra']);
  assert.deepStrictEqual(tipos("echo 'a <<EOF'\na\\\\b\nEOF"), []);
  assert.deepStrictEqual(tipos('echo x # <<EOF\na\\\\b\nEOF'), [], 'o << do comentario');
  // sem terminador o bash le ate o fim: aqui nao se afirma (o corpo pode ser so o resto do comando)
  assert.deepStrictEqual(tipos('cat <<EOF\na\\\\b'), []);
  // dois heredocs na mesma linha: os corpos vem em ordem, e so o sem aspas conta
  assert.deepStrictEqual(tipos("cat <<'A' - <<B\na\\\\b\nA\nsem\nB"), []);
  assert.deepStrictEqual(tipos("cat <<'A' - <<B\nsem\nA\na\\\\b\nB"), ['heredoc-barra']);
  // a conta ja fechada antes nao esconde o heredoc da mesma linha
  assert.deepStrictEqual(tipos('echo $((1+2)) <<EOF\na\\\\b\nEOF'), ['heredoc-barra']);
  // o comando com fim de linha do Windows (CRLF) fecha o heredoc do mesmo jeito
  assert.deepStrictEqual(tipos('cat > x <<EOF\r\na\\\\b\r\nEOF\r\n'), ['heredoc-barra']);
});

test('F3d: grep -c logo antes de && e armadilha; com ; || ou cano depois, nao', () => {
  for (const c of ['grep -c foo a.txt && echo ok', 'grep -rnc foo src && echo ok', 'grep --count foo a && echo ok',
    'n=$(grep -c foo a.txt) && echo $n', '( grep -c foo a.txt ) && echo ok', 'git grep -c foo && echo ok',
    'ls | grep -c foo && echo ok', 'X=1 grep -c foo a && echo ok', '! grep -c foo a && echo ok',
    'grep -m 1 -c foo a && echo ok', 'grep -e x -c a && echo ok', 'grep -m1 -c foo a && echo ok',
    // os outros greps e os prefixos que deixam o comando ser o mesmo
    'egrep -c x f && y', 'fgrep -c x f && y', 'time grep -c x f && y', 'sudo grep -c x f && y', 'command grep -c x f && y',
    // o git com opcao global antes do grep, e o argumento entre aspas que continua contando como palavra
    'git -C "$d" grep -c foo && echo ok', 'git --no-pager grep -c x && y', 'git -c a=b grep -c x && y',
    'grep -e "x" -c f && y',
    // o & de redirecionamento nao separa comandos
    'grep -c foo f 2>&1 && echo ok', 'grep -c foo f &>/dev/null && echo ok', 'grep -c foo f >&2 && echo ok',
    // o << de uma conta nao e heredoc: a linha de baixo segue sendo comando
    'echo $((a<<b))\ngrep -c x f && rm y', 'x=$((1 << N))\ngrep -c x f && y',
    // o comentario com apostrofo nao abre texto
    "echo x # it's\ngrep -c a f && y", 'sleep 1 & grep -c x f && y']) {
    assert.deepStrictEqual(tipos(c), ['grep-conta'], c);
  }
  for (const c of ['grep -c foo a.txt; echo ok', 'grep -c foo a.txt || true && echo ok', 'grep -c foo a | wc -l && echo ok',
    'grep -ec a.txt && echo ok', 'grep -e -c a && echo ok', 'grep -m -c a && echo ok', 'grep -C 3 foo a && echo ok',
    'grep foo a && echo ok', 'grep -- -c a && echo ok', 'git commit -m "grep -c x && y"', 'echo grep -c x && y',
    'cat <<EOF\ngrep -c x f && y\nEOF', 'grep -c foo a', 'echo "a; grep -c x && y"', 'grep "-c" f && y',
    'grep -c x f |& cat && y']) {
    assert.deepStrictEqual(tipos(c), [], c);
  }
});

test('F3d: grep -P so e armadilha no Windows, sem locale UTF-8 na frente e fora do git grep', () => {
  assert.deepStrictEqual(tipos("grep -P 'a(?=b)' f"), ['grep-perl']);
  assert.deepStrictEqual(tipos("grep -rnP 'a' f"), ['grep-perl']);
  assert.deepStrictEqual(tipos("grep --perl-regexp 'a' f"), ['grep-perl']);
  assert.deepStrictEqual(tipos("grep -oP 'a' f && echo ok"), ['grep-perl']);
  assert.deepStrictEqual(tipos("grep -cP 'a' f && echo ok"), ['grep-conta', 'grep-perl'], 'as duas no mesmo grep');
  for (const c of ["LC_ALL=C.UTF-8 grep -P 'a' f", "LANG=en_US.UTF-8 grep -P 'a' f", "LC_CTYPE=C.utf8 grep -P 'a' f",
    "git grep -P 'a'", "grep -E 'a|b' f", "grep -eP f", 'LC_ALL="C.UTF-8" grep -P x f', "LC_ALL='C.UTF-8' grep -P x f"]) {
    assert.deepStrictEqual(tipos(c), [], c);
  }
  assert.deepStrictEqual(tipos("LC_ALL=C grep -P 'a' f"), ['grep-perl'], 'o locale sem UTF-8 nao conserta');
  assert.deepStrictEqual(tipos('LC_ALL="C" grep -P x f'), ['grep-perl'], 'nem entre aspas');
  assert.deepStrictEqual(tipos("grep -P 'a' f", 'linux'), []);
  assert.deepStrictEqual(tipos("grep -P 'a' f", 'darwin'), []);
});

test('H6h: sed -i sem -b no Windows e armadilha (regrava o CRLF); com -b, sem -i ou fora do Windows, nao', () => {
  for (const c of ['sed -i s/a/b/ f', "sed -i 's/a/b/' f", 'sed -i.bak s/a/b/ f', 'sed --in-place s/a/b/ f',
    'sed --in-place=.bak x f', 'sed -Ei x f', 'sed -ni p f', 'sed -e x -i f', "sed 's/a/b/' -i f", 'X=1 sed -i x f',
    'cat f && sed -i x f', 'sudo sed -i x f', 'ls; sed -i x f',
    // no grupo, o i leva o resto como sufixo da copia: `-ib` e sufixo b, nao binario
    'sed -ib x f',
    // o valor colado no grupo (-ex) nao leva a palavra seguinte; o -l solto leva a dele
    'sed -ex -i f', 'sed -l 5 -i x f']) {
    assert.deepStrictEqual(tipos(c), ['sed-crlf'], c);
  }
  for (const c of ['sed -b -i x f', 'sed -i -b x f', 'sed --binary -i x f', 'sed -bi x f', 'sed s/a/b/ f', 'sed -n p f',
    // o -i que e valor de outra opcao, ou que vem depois do --, nao e o modo no lugar
    'sed -e -i f', 'sed -f -i f', 'sed -l -i f', 'sed -- -i f', 'sed --expression -i f', 'sed -ei f',
    // a opcao longa com i no nome nao e o grupo curto
    'sed --silent p f', 'sed --debug x f',
    "echo 'sed -i x f'", 'git commit -m "sed -i x"', 'echo sed -i x f', 'cat <<EOF\nsed -i x f\nEOF']) {
    assert.deepStrictEqual(tipos(c), [], c);
  }
  assert.deepStrictEqual(tipos('sed -i x f', 'linux'), []);
  assert.deepStrictEqual(tipos('sed -i x f', 'darwin'), []);
  assert.deepStrictEqual(armadilhas.achar('sed -i x f', 'Bash', undefined), [], 'sem plataforma declarada nao se confere');
});

test('H6h: crase nas aspas duplas do codigo do node -e/-p e armadilha em qualquer sistema', () => {
  for (const c of ['node -e "const x = `echo 41`; console.log(x)"', 'node -p "`date`.length"', 'node -pe "`a`"',
    'node --eval "`a`"', 'node --print "`a`"', 'node --input-type=module -e "x(`a`)"', 'node -r foo -e "`a`"',
    'node.exe -e "`a`"', 'X=1 node -e "`a`"', 'cd x && node -e "`a`" | head', 'node -e "\nconst a = `x`;\n"',
    // a barra dupla antes da crase e barra literal: a crase segue rodando
    'node -e "a\\\\`b`"',
    // o valor da opcao separado (--input-type module), o prefixo, a barra que emenda a linha e o # no meio da palavra
    'node --input-type module -e "`a`"', 'sudo node -e "`a`"', 'node \\\n  -e "`a`"', 'echo a#b; node -e "`x`"',
    // a forma colada --eval=/--print= e a barra que emenda com CRLF (o Git Bash emenda tambem)
    'node --eval="`a`"', 'node --print="`a`"', 'node -r x --eval="f(`a`)"', 'node \\\r\n  -e "`a`"',
    // outras opcoes do node com o valor na palavra seguinte (medido: o node aceita a forma com espaco)
    'node --title meuapp -e "`a`"', 'node --env-file .env -e "`a`"', 'node --test-reporter spec -e "`a`"']) {
    assert.deepStrictEqual(tipos(c, 'linux'), ['node-crase'], c);
  }
  assert.strictEqual(armadilhas.achar('node --eval="`a`"', 'Bash', 'linux')[0].trecho, 'node --eval');
  assert.deepStrictEqual(tipos("node --eval=\"f('/tmp/x')\""), ['node-tmp'], 'a forma colada no Windows');
  for (const c of ["node -e 'const x = `a`'", 'node -e "x(\\`a\\`)"', 'node -e `cat x.js`', 'node x.js -e "`a`"',
    'echo "node -e `a`"', 'git commit -m "node -e `x`"', 'node -e "a" && echo "`date`"', 'node -e "a" # "`x`"', 'echo x # ; node -e "`a`"',
    'node -e "sem crase"', 'node -e', 'node -r -e "`a`"', 'nodejs -e "`a`"', 'cat <<EOF\nnode -e "`a`"\nEOF',
    "node --eval='`a`'", 'node --eval="a"', 'node x.js --eval="`a`"']) {
    assert.deepStrictEqual(tipos(c, 'linux'), [], c);
  }
});

test('H6h: caminho do Git Bash e /tmp numa string do codigo do node sao armadilha so no Windows', () => {
  for (const c of ["node -e \"require('/c/proj/x/a.js')\"", "node -e 'require(\"/c/proj/x\")'",
    'node -p "fs.existsSync(\\"/d/proj\\")"']) {
    assert.deepStrictEqual(tipos(c), ['node-caminho-bash'], c);
  }
  assert.deepStrictEqual(tipos("node -e \"fs.readFileSync(`/c/x`)\""), ['node-crase', 'node-caminho-bash'],
    'a crase tambem abre string do codigo');
  for (const c of ["node -e \"require('C:/proj/x')\"", "node -e \"s.replace(/c/g, '')\"", "node -e \"require('./c/x')\"",
    'node x.js /c/Users', "node -e \"'/c/'\"", "echo \"require('/c/Users')\""]) {
    assert.deepStrictEqual(tipos(c), [], c);
  }
  for (const c of ["node -e \"fs.writeFileSync('/tmp/x', 'a')\"", "node -e 'path.join(\"/tmp\", \"x\")'",
    "node -e \"fs.readdirSync('/tmp')\"", 'node -e "f(\\"/tmp/a\\")"']) {
    assert.deepStrictEqual(tipos(c), ['node-tmp'], c);
  }
  for (const c of ["node -e \"fs.writeFileSync(os.tmpdir() + '/x')\"", "node -e \"'/tmpx'\"", "node -e \"'/var/tmp/x'\"",
    'node x.js /tmp/a', "echo \"'/tmp/x'\""]) {
    assert.deepStrictEqual(tipos(c), [], c);
  }
  const tres = "node -e \"require('/c/x/a'); fs.writeFileSync('/tmp/y', `z`)\"";
  assert.deepStrictEqual(tipos(tres), ['node-crase', 'node-caminho-bash', 'node-tmp']);
  assert.deepStrictEqual(tipos(tres, 'linux'), ['node-crase'], 'fora do Windows so a crase');
});

test('H6h: o aviso das armadilhas novas traz o conserto de cada uma, em ASCII', () => {
  const c = "sed -i x f; node -e \"require('/c/x/a'); f('/tmp/y', `z`)\"";
  const achadas = armadilhas.achar(c, 'Bash', 'win32');
  assert.deepStrictEqual(achadas.map((a) => a.tipo), ['node-crase', 'node-caminho-bash', 'node-tmp', 'sed-crlf']);
  assert.deepStrictEqual(achadas.map((a) => a.trecho), ['node -e', 'node -e', 'node -e', 'sed -i x f']);
  const m = armadilhas.motivo(c, achadas);
  assert.ok(/^[\n\x20-\x7E]*$/.test(m), 'ASCII (R5)');
  assert.match(m, /Conserto: -b junto do -i \(sed -b -i \.\.\.\)/);
  assert.match(m, /Conserto: aspas simples em volta do codigo \(node -e '\.\.\.'\)/);
  assert.match(m, /Conserto: escreva o caminho do Windows no codigo \(C:\/proj\/\.\.\.\)/);
  assert.match(m, /Conserto: require\('os'\)\.tmpdir\(\) no codigo/);
  assert.match(m, /o node le \\tmp na raiz do drive atual \(C:\\tmp, por exemplo\)/);
  assert.match(m, /da ENOENT, ou grava no lugar errado sem aviso/);
  assert.match(m, /sem o \\r \(o CRLF vira LF/);
});

test('F3d: so a ferramenta Bash e so comando em texto', () => {
  assert.deepStrictEqual(armadilhas.achar('grep -c x f && y', 'PowerShell', 'win32'), []);
  assert.deepStrictEqual(armadilhas.achar(null, 'Bash', 'win32'), []);
  assert.deepStrictEqual(armadilhas.achar('', 'Bash', 'win32'), []);
});

test('F3d: o aviso diz cada armadilha uma vez, com o conserto, na forma dos avisos e em ASCII', () => {
  const c = "grep -c a f && grep -c b f && cat > x <<EOF\na\\\\b\nEOF\ngrep -P 'x' y";
  const achadas = armadilhas.achar(c, 'Bash', 'win32');
  assert.deepStrictEqual(achadas.map((a) => a.tipo), ['heredoc-barra', 'grep-conta', 'grep-conta', 'grep-perl']);
  const m = armadilhas.motivo(c, achadas);
  assert.ok(/^[\n\x20-\x7E]*$/.test(m), 'ASCII (R5)');
  const linhas = m.split('\n');
  assert.match(linhas[0], /^sworn - comando com armadilha do shell: .*\.$/);
  assert.strictEqual(linhas[1], '');
  assert.strictEqual((m.match(/grep -c antes de &&/g) || []).length, 1, 'cada armadilha uma vez: ' + m);
  assert.match(m, /Conserto: aspas no delimitador \(<<'EOF'\)/);
  assert.match(m, /\(\\\\ vira \\, e a barra no/);
  assert.match(m, /Conserto: troque o && depois dele por ;/);
  assert.match(m, /Conserto: LC_ALL=C\.UTF-8 na frente/);
  assert.match(m, /\n\nFaca assim: reescreva o comando/);
  assert.match(linhas[linhas.length - 1], /^So o dono libera: .*"comandosLiberados".* \.claude\/sworn\/projeto\.json\.$/);
  assert.strictEqual(linhas[linhas.length - 2], '');
  // o comando vai inteiro ate 300 caracteres; com 301, os 300 primeiros e a conta
  const g = [{ tipo: 'grep-conta', trecho: 'grep -c x f' }];
  const trezentos = 'grep -c x f && ' + 'y'.repeat(285);
  assert.ok(armadilhas.motivo(trezentos, g).indexOf('Comando: ' + trezentos + '\n') !== -1, 'ate 300 vai inteiro');
  assert.ok(armadilhas.motivo(trezentos + 'z', g).indexOf('Comando: ' + trezentos + '...(301 caracteres)\n') !== -1,
    'com 301, os 300 primeiros e a conta');
});

function projeto(nome, extra) {
  const dir = pasta(nome);
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify(Object.assign({
    marchaPadrao: 'padrao', plataforma: { so: 'win32', shell: 'bash' } }, extra || {})));
  return dir;
}

/** O portao com o comando. Devolve o motivo da negacao, ou null quando passou: e passar e sair sem escrever nada (a
 *  saida torta ou outra decisao reprovam aqui, nao viram "passou"). */
function chamar(dir, tmp, id, ferramenta, comando) {
  const r = rodar('scripts/portao-destrutivo.js', [], { cwd: dir, env: { SWORN_TMP: tmp },
    entrada: { session_id: id, cwd: dir, hook_event_name: 'PreToolUse', tool_name: ferramenta, tool_input: { command: comando } } });
  assert.strictEqual(r.status, 0, r.stderr);
  if (r.stdout.trim() === '') return null;
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.hookSpecificOutput.permissionDecision, 'deny', r.stdout);
  return j.hookSpecificOutput.permissionDecisionReason;
}

const negado = (motivo) => motivo;
const balde = (tmp, id) => {
  try { return (JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', id + '.json'), 'utf8')).contadores || {}).armadilha_shell; }
  catch (e) { return undefined; }
};

test('F3d: pelo portao, a armadilha nega no Bash e enche o balde armadilha_shell; o comando sem ela passa', () => {
  const dir = projeto('arm-portao');
  const tmp = pasta('arm-tmp');
  const nega = negado(chamar(dir, tmp, 'a1', 'Bash', 'grep -c foo a.txt && echo ok'));
  assert.ok(nega && /^sworn - comando com armadilha do shell/.test(nega), String(nega));
  assert.strictEqual(balde(tmp, 'a1'), 1);
  const perl = negado(chamar(dir, tmp, 'a1', 'Bash', "grep -P 'a' f"));
  assert.ok(perl && /grep -P no Git Bash/.test(perl) && /LC_ALL=C\.UTF-8/.test(perl) && !/grep -c antes/.test(perl), perl);
  assert.strictEqual(balde(tmp, 'a1'), 2);
  // o comando sem armadilha passa e nao conta; o PowerShell nao e lido aqui
  assert.strictEqual(negado(chamar(dir, tmp, 'a1', 'Bash', 'grep -c foo a.txt; echo ok')), null);
  assert.strictEqual(negado(chamar(dir, tmp, 'a2', 'PowerShell', 'grep -c foo a.txt && echo ok')), null);
  assert.strictEqual(balde(tmp, 'a1'), 2);
  assert.strictEqual(balde(tmp, 'a2'), undefined);
  // o grep -P fora do Windows passa, e sem plataforma declarada nao se confere (o grep -c segue barrado)
  const linux = projeto('arm-linux', { plataforma: { so: 'linux', shell: 'bash' } });
  assert.strictEqual(negado(chamar(linux, tmp, 'a3', 'Bash', "grep -P 'a' f")), null);
  const semPlataforma = projeto('arm-sem-plat', { plataforma: undefined });
  assert.strictEqual(negado(chamar(semPlataforma, tmp, 'a4', 'Bash', "grep -P 'a' f")), null);
  assert.ok(negado(chamar(semPlataforma, tmp, 'a4', 'Bash', 'grep -c a f && y')));
  // o contador que nao se grava (a pasta de estado e um arquivo) nao impede a negacao
  const torto = path.join(pasta('arm-torto'), 'arquivo');
  fs.writeFileSync(torto, 'x');
  assert.ok(negado(chamar(dir, torto, 'a5', 'Bash', 'grep -c a f && y')));
});

test('F3d: a liberacao e a do resto da trava 5 - comandosLiberados e travas.destrutivo false', () => {
  const tmp = pasta('arm-lib-tmp');
  const liberado = projeto('arm-liberado', { comandosLiberados: ['^grep -c'] });
  assert.strictEqual(negado(chamar(liberado, tmp, 'l1', 'Bash', 'grep -c foo a && echo ok')), null);
  const desligado = projeto('arm-desligado', { travas: { destrutivo: false } });
  assert.strictEqual(negado(chamar(desligado, tmp, 'l2', 'Bash', 'grep -c foo a && echo ok')), null);
});

test('F3d: a linha de situacao diz quantos agentes rodam, ate 3 pelo nome, e o plano quando ha', () => {
  const ag = (d, id) => ({ id: id || d, descricao: d });
  assert.strictEqual(saude.linhaDeSituacao([ag('R1 busca')], ''),
    'sworn - situacao: 1 agente em segundo plano roda (R1 busca); o trabalho segue sozinho quando ele voltar.');
  const quatro = saude.linhaDeSituacao([ag('a'), ag('b'), ag('c'), ag('d')], 'plano x · 3 de 9');
  assert.strictEqual(quatro, 'sworn - situacao: 4 agentes em segundo plano rodam (a; b; c; e mais 1); o trabalho segue ' +
    'sozinho quando eles voltarem.\nPlano: plano x · 3 de 9.');
  // sem descricao, o id; descricao longa e com acento sai cortada e em ASCII
  assert.match(saude.linhaDeSituacao([{ id: 'x9', descricao: '' }]), /\(agent-x9\)/);
  assert.match(saude.linhaDeSituacao([{ id: 'x8', descricao: '   ' }]), /\(agent-x8\)/, 'so espaco vale como sem descricao');
  const longa = saude.linhaDeSituacao([ag('revis\u00e3o ' + 'z'.repeat(80))]);
  assert.strictEqual(longa, 'sworn - situacao: 1 agente em segundo plano roda (revisao ' + 'z'.repeat(32) + '); o ' +
    'trabalho segue sozinho quando ele voltar.');
  // 2 e 3 agentes: plural e sem "e mais"; quebra de linha na descricao vira espaco
  assert.match(saude.linhaDeSituacao([ag('a'), ag('b')]), /: 2 agentes em segundo plano rodam \(a; b\); .* eles voltarem\.$/);
  assert.match(saude.linhaDeSituacao([ag('a'), ag('b'), ag('c\nd')]), /rodam \(a; b; c d\); /);
  // o plano que nao e texto, vazio ou so espaco nao entra; o que ja termina em ponto nao ganha outro
  for (const p of [null, undefined, 5, '', '   ']) assert.ok(!/Plano:/.test(saude.linhaDeSituacao([ag('a')], p)), String(p));
  assert.match(saude.linhaDeSituacao([ag('a')], 'proxima: F3d.'), /\nPlano: proxima: F3d\.$/);
  assert.ok(/^[\n\x20-\x7E]*$/.test(saude.linhaDeSituacao([ag('a\u00e7\u00e3o')], 'x')), 'ASCII');
});
