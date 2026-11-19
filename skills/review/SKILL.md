---
name: review
description: Blind A/B review of a changed file. Labels the two sides without authorship, dispatches inspectors with distinct lenses and a default of reject, and tallies by script with a cap of 3 rounds. Use when the work is written and before calling it done.
argument-hint: "<path of the changed file>"
---

# `/sworn:review` — the blind review

Original failure: **I am optimistic when judging my own code.** Generator and evaluator have the
same weights; when I review what I wrote, I don't read the code, I re-derive the reasoning that
produced it — and the reasoning that produced the bug reproduces the bug.

## Step 1 — prepare the blind package

    node "${CLAUDE_PLUGIN_ROOT}/scripts/preparar-revisao.js" --arquivo '<caminho>' [--completa]

The script writes `A.txt`, `B.txt` and `mapa.json` in `.claude/sworn/revisao/<arquivo>/<n>/`: each
file has its own base, and `<n>` is its round. The `<arquivo>` is the file id: each `/` in the path
becomes `__`, each character outside unaccented letters, digits, `.` and `-` becomes `~` and its code in 4 hex
digits (`_` becomes `~005f`; an emoji, which is two UTF-16 units, becomes two such codes), an id made only of digits or only of dots gets a `_` in front, and an id over 150
characters is cut and ends in `~~` plus a hash (rule of the `idDoArquivo` function, in `scripts/lib/cegar.js`). A
review started under the old id stays in its old folder until the next preparation moves it. The exact path comes in
the output (`a`, `b`, `vereditos` and `base`); use what the output says, don't rebuild it.
**You don't open `mapa.json`, and no inspector receives its path.** In a style file with a `design.json`, the round
also has `detector.json`: what the design detector found, hidden from the inspectors so the `ui-design` lens judges
without it; the tally crosses the two after the verdicts (`detector` in its output). A screen file that already
existed in the HEAD gets `inventario.json` (what the HEAD side wired, which would tell the old side apart). The same
rule holds for both: don't open them, and no inspector receives their path.

When `projeto.json` declares `referencias` for the file's type (text, screen or code), the output also brings
`referencia` (the path of `R.txt`, the top reference) and `invertida` (`a`, `b` and `vereditos`): the
package has a 2nd pass, with A and B swapped (Step 2).

**Several files = one base each.** Prepare, inspect and tally one file at a time; each has
its own rounds and its own cap of 3. If the output warns "formato antigo", there is a 0.3.0 review
in progress in loose numbered folders: it continues on the single base until it ends.

Don't slice by hand. A slice that cuts a function in the middle makes the inspector report the cut as a defect and
contaminates the round. In the `completa` band (Step 2), `A.txt` and `B.txt` are the whole file. In the small
bands, when the output brings `trecho`, the script already cut it: each side carries only the changed excerpt,
with a margin of `trecho.margem` lines, in the file's line numbers; the lines outside are
blank and the first of each gap says `[fora do trecho: linhas a-b]`. In a JavaScript file, the excerpt also keeps
visible, on both sides, the `require` line and the top-level definition of each name it uses (the whole definition up
to 15 lines, otherwise its leading comment and signature); what it uses from another file of the project goes in
`contrato.txt`, and the output brings its path in `contrato`. When lines are kept visible this way, `trecho` also
brings `extras` (how many ranges, on both sides).

**Degraded review.** When the inspectors cannot run isolated (no subagent, so the review runs in your own context,
or the only agent the harness has can open the repository) or a screen lens judges without the screen photos
(no `--tela-depois`, below), prepare every round with `--degradado "<motivo>"`. The tally then opens its `motivo` with `DEGRADADO: <motivo>`, and
the answer that says the work is done must carry a line `DEGRADADO: <motivo>`; the stop gate blocks it otherwise. One
degraded round degrades the whole review, since its dry rounds count toward the approval. A new review with
isolation, without the flag, clears the mark.

**Screen photo, one per side.** When the change touches a screen, add `--tela-depois <url>` (the page with the work)
and `--tela-antes <url>` (the same page in the HEAD version, running elsewhere: a copy of the repository at HEAD in
another folder or on another port). Step 1 photographs each one with `scripts/capturar-tela.js` and writes `A.png` and
`B.png`, with `A.evidencia.json` and `B.evidencia.json` (the page's console messages, its errors and its accessibility
tree, the list of what can be read and clicked), under the same blind labels as `A.txt` and `B.txt`. The address, the
time and the sha256 of each photo (the proof it was not swapped) go only to `mapa.json`;
in the inspector's evidence the page address becomes `[pagina]`. The output brings `fotos` with the paths, by blind letter. A capture
that fails stops Step 1 with `ERRO:` and nothing written: fix what it says (the address, the server, the browser) and
run again. With `--tela-depois` alone, only the work's side has a photo, so the photo is not blind in that round: say so
at the close-out. Each round of a screen review takes the photos again, so prepare every round with the same addresses.

**Screen against a reference screen, width by width.** When the work is a screen and there is a page to match (the
page the `tela` reference sheet photographed, whose address is in its findings' origin, or a page the owner points
to), run, from the project root:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/conferir-tela.js" --url <the work> --referencia <the reference page> --saida <folder>

It captures both pages at 1440, 768 and 390 px (`--larguras` changes the list) and writes `conferencia.json`: for each
width, what differs (horizontal scroll, the h1, h2 and body text size beyond 2 px, the main column beyond 8 px, how many
blocks sit side by side) and what could not be compared. With `.claude/sworn/design.json`, a type difference also names
the system size closest to the reference's. It exits 0 when everything was compared and 1 otherwise: what was not
compared never counts as alike, and the stop gate blocks "done" while the last run exited 1. Differences alone do not make it exit
1: fix each one, or tell the owner why it is on purpose. What was not compared: fix its cause (the address, the server,
the call) and run again; when it cannot be fixed (a reading cut on a huge page), check it on the photo and tell the
owner what stays uncompared and why, which releases the gate. Run it with nothing after it (no `| tail`, no `; echo`):
with a pipe or another command after it, the exit code is not its own, and the gate counts the run as passed only when
the output shows `"tudoComparado":true`.

## Step 2 — round 1: the change band, then the lenses of the right family

**First the band: the review is proportional to the diff** (owner's decision, 2026-10-12). The output of Step 1 brings
`faixa`, `lentes` and `linhasMudadas` (the larger side of the diff against HEAD: lines removed or added).
The lenses of each band are in `scripts/lib/veredito.js` → `lentesDaFaixa`.

| `faixa` | When | How many inspectors |
|---|---|---|
| `uma` | up to 3 changed lines: only a comment, a number or a short phrase | **1**: `correcao` |
| `duas` | up to 40 lines of logic, with a red test and mutation already run | **2**: `correcao` and `borda` |
| `texto` | text (`.md`, `.markdown`, `.txt`) the model reads as instructions (skill, agent, command, rule, hook, prompt, `CLAUDE.md` and kin) or the README, with more than 3 changed lines | **2**: `correcao` and `microcopy` |
| `doc` | any other text (changelog, guide, docs) with more than 3 changed lines: the check is the facts against the code | **1**: `correcao` |
| `completa` | new file, more than 40 lines of logic, style, equal to HEAD or unmeasured | the table of families, below |

The script measures lines, not meaning. **You can move up a band, never down:** 3 lines that change logic go up to
`duas`; `duas` without a red test and mutation run goes up to `completa`; a change that builds a screen goes up to `completa`.
To go up to `completa`, pass `--completa` in Step 1: the package comes out with the whole file, with no excerpt. If the round was already
prepared without it, delete its folder, which has no verdicts yet, and prepare again with the flag.
Tell the user the band used and, if you went up, why. The stop rule (Step 5) is the same in every band.

**Two families, by owner's decision.** They diverge **by design**:
the code one judges code, the UI one judges screens. They are not merged.

| What changed | How many inspectors | Where the lenses are |
|---|---|---|
| Logic only (not style and doesn't build a screen) | **8** | `scripts/lib/veredito.js` → `LENTES` without those in `SAEM_SO_LOGICA` (`design`, `medidor`) |
| Code only | **10** | `scripts/lib/veredito.js` → `LENTES` |
| Screen only | **9** | `scripts/lib/veredito.js` → `lentesSoTela`: `LENTES_UI` and the request lens, `escopo` |
| Code and screen | **18** | both lists |

**In the `completa` band the output of Step 1 brings `lentes`, chosen by risk** (owner's decisions, 2026-11-10 and
2026-11-12): the family of the table, minus `seguranca` when the changed lines, on both sides, touch nothing risky
(a process, a file or path, parsing outside input, the environment, the network, the page DOM, a secret) and the file
is not a hook, manifest, configuration or shell script; minus `enxuto` when the change is small (40 lines or fewer, and
not a new file); and the screen lenses (`LENTES_UI`) only when the round has the photos (`--tela-depois`). Measured on
the closed reviews, `seguranca` and `enxuto` found only 4 P0/P1 each that no other lens found; `estados` and `borda`
stay apart (only 32% of what `estados` found, `borda` also found). **A test file** (in a `test/`, `tests/`,
`__tests__/` or `spec/` folder, or named `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.py` or `*_test.go`) gets only
`correcao`, `estados`, `borda` and `manutencao` (owner's decision, 2026-11-18): in 888 rounds, the other four spent
301 inspectors on test files and found 3 P0/P1 that no other lens found. Dispatch every lens in `lentes`: the list goes into
`mapa.json`, and the tally checks that each one voted. You can add a lens the script left out, never drop one; a
screen change without the photos gets no screen lens, so prepare with `--tela-depois` to have them.

**The change touches a screen** when the declared scope includes a style file
(`scripts/lib/design.js` → `ehArquivoDeEstilo`) or markup that the project renders.
When in doubt, **both families** — the stricter gear wins.

**A logic-only file** — one that is not style and doesn't build a screen — skips the `design` lens (owner's
decision, 2026-09-29) and, since 2026-10-11, also `medidor` (in round 1 of 41 reviews, 11 of 13 of its findings
were refuted at the source): that is 8 inspectors, the ones in `LENTES` without those in `SAEM_SO_LOGICA`. The
`escopo` lens stays in the logic-only file: it judges against the task's request, `pedido.md`. When in doubt, the 10 — they only leave out when it is clear the file is not style and
doesn't build a screen.

**Lens `escopo` (the request)** — it goes in every review of the `completa` band except a test file's: in the code family, and in the
screen-only review next to the eight screen lenses. Step 1 writes `pedido.md` in the round (the `**Objetivo:**` line and the
`## Dentro` list, what the task may touch, of the scope file in force; the output brings `pedido`, or `semPedido` when
no scope is declared). Add to the `escopo` inspector's briefing: "Also read `<pedido>`: it is the task's request."
With `semPedido`, dispatch the lens without that line (it then judges only changes that look unrelated to the diff's
purpose) and tell the user that no scope was declared, so the request was not checked, and where to declare it (the
path `semPedido` names). The lens reports three things: items the request asks
for that were not delivered and items that look done but are wrong, both quoting the `pedido.md` line, and changes
nobody asked for, citing the changed code. Step 3's output
brings `eixos`: the new findings of the last round split into `padrao` (every other lens) and `pedido` (this lens),
each with its count and worst severity. Present the two axes apart, never as one score, labeled in the user's language
(code standard, and fidelity to the request): a clean axis must not hide the other.

**Lens `enxuto` (code that didn't need to exist, since 0.9.0)** — born under observation, because a lens
that judges "too much" was already refuted at the source in 5 of 6 findings (`escopo`, before it got the `pedido.md`). **Exit rule:** after 10
reviews with it, if 2 of every 3 of its findings were refuted at the source (no script counts this: whoever
maintains sworn counts it, from the `enxuto` entries in the reviews' `refutados.json`), it goes into
`SAEM_SO_LOGICA` and leaves the logic-only file, like `medidor`. Validation at the boundary, data loss,
security and accessibility are never excess: a finding of its against these is refuted. A deliberate shortcut,
with the comment `atalho: <o que>. limite: <até onde vale>. trocar quando: <gatilho>.`, is declared
debt, not excess; the ones that don't carry the trigger are listed by `/sworn:shortcuts` — run it before a release.

Read the lenses from the file, **not from memory**. Dispatch them all in the same burst, **one `sworn:inspector`
subagent per lens**.

Outside Claude Code the installer writes the inspector as `sworn-inspector` (and the judge as `sworn-dedupe-judge`):
dispatch it with `spawn_agent` and `agent_type: "sworn-inspector"` in Codex (then `wait_agent` for the answers),
with `agent` (Qwen Code; load it with `tool_search` first) or `task` (OpenCode) and `subagent_type: "sworn-inspector"`.
agy and dsh have only the default agent: dispatch it with the briefing below preceded by the whole body of
`agents/inspector.md` (the role). The subagent sends its JSON to the caller with `send_message`, and the hook writes it
from there.

Briefing of each one, exactly in this form:

> Your lens is **<titulo>** (`<chave>`): <pergunta>.
> Read only these two files: `<caminho de A.txt>` and `<caminho de B.txt>`.
> Also read `<caminho de regua.md>`: it is the project's ruler. A finding about a value outside the ruler cites the ruler's value.
> Verdicts folder: `<caminho de vereditos>`. Don't open it: copy the path, untouched, into the `vereditos` field of the JSON, and put the lens key (`<chave>`) in the `lente` field.
> Don't open the repository. Don't open `mapa.json`, `detector.json` or `inventario.json`. Return only the JSON of
> your format.

When the output of Step 1 brings `trecho`, add to the briefing, right after the line with the two files:

> A and B are excerpts: only the changed excerpt, with margin. The line `[fora do trecho: linhas a-b]` marks what was left out, and the blank lines after it are that gap. The gap is not a defect: if the answer depends on what is outside, say "I can't see it", and that finding is `pendente`, with what is outside in `falta`.

When `trecho` also brings `extras`, add right after that line:

> A line kept visible inside a gap is the `require` or the top-level definition of a name the excerpt uses (the whole definition up to 15 lines, otherwise its leading comment and signature). If the answer depends on a body you can't see, the finding is `pendente`.

When the output of Step 1 also brings `contrato`, add after them:

> Also read `<caminho de contrato.txt>`: what the excerpt uses from other files of the project (the leading comment and signature, or the whole definition when it is short), the same for A and B. It is context, not under review: never cite it in a finding.

The ruler line only goes in when the output of Step 1 brings `regua` with a path. When it brings
`semRegua`, tell the user the review ran **without a project ruler** — the inspector judged by
common sense, not by the declared system.

**With a reference** (the output of Step 1 brings `referencia`), add to the briefing, after the ruler line:

> Also read `<caminho de R.txt>`: it is the top reference, named (it is not A or B). Judge each side against it and return `vsReferencia` and `lacunas`, as your format says.

**With photos** (the output of Step 1 brings `fotos`), add to the briefing of each screen lens, after the line with
the two files, the paths that `fotos` gives (a side with `null` has no photo: leave it out and say so in the line):

> Also open `<fotos.A.imagem>` and `<fotos.B.imagem>` (Read shows the image), and read `<fotos.A.evidencia>` and `<fotos.B.evidencia>`: the screen of each side, with its console, page errors and accessibility tree. A finding about what you see cites the image and the coordinate, or the evidence entry.

With a reference, the 2nd pass uses `invertida/A.png`, `invertida/B.png` and their `.evidencia.json`, which Step 1
already wrote with the labels swapped.

**With the design system** (the output of Step 1 brings `design`: a style file in a project with
`.claude/sworn/design.json`), add to the briefing of each screen lens, after the ruler line:

> Also read `<design>`: the project's design system and the deviations declared for this file, each with its reason. A raw value (color, measure, shadow) that is in neither is an undeclared deviation: report it with the value and the line.

A screen that really needs a value the system lacks gets a deviation in `design.json` (`desvios`: the files, the
reason and, optionally, an end date), decided by the owner; the scope gate then accepts that value only in those files.

And dispatch the **2nd pass**: the same lenses again, one subagent per lens, with the same briefing swapping
the two files for `invertida.a` and `invertida.b` and the verdicts folder for `invertida.vereditos`
(`<ronda>/invertida/vereditos`). It is the swapped A/B order: against the reference, only what repeats in both
orders counts (owner's decision, 2026-10-13). The two passes can go in the same burst. **The cost doubles**: each lens runs
twice; tell the user that along with the number of agents.

**The hook writes** (`scripts/gravar-veredito.js`, on the inspector's `SubagentStop` and on the subagent's handback;
outside Claude Code, through the bridge in all five; in agy and dsh only a `send_message` whose JSON has the
`vereditos` field counts as the inspector's): it
pulls the JSON out of the response and writes it to `<lente>.json` in the `vereditos` folder the inspector returned, checking that it is
that of a round. It never blocks and never overwrites a file that already exists. Before Step 3, **check that there is
one file per dispatched lens** in `vereditos/` (list the folder and count), and, with a reference, also in
`invertida/vereditos/`. Whatever the hook warned it didn't write, or that
isn't there, write by hand, as `<lente>.json` (the lens key), with the JSON the inspector returned, at the path
`vereditos` from the output of Step 1. **In a configured project, the `Write` to `.claude/sworn/revisao/**.json` can be
denied by the scope gate** ("lock 4": it only lets you write what the task's declared scope covers). The
declared scope is in `.claude/sworn/escopo.md`; if the session works on a front (a parallel line of work
of the same project), it is in `.claude/sworn/escopos/<frente>.md`, the front's file. Add
`.claude/sworn/revisao/**` to the "Dentro" section of whichever is in force, with `Edit`, without erasing the rest, and write
again (the gate doesn't block the edit of the scope file itself, but it counts the expansion and flags it at the close-out
of the turn). If the scope in force belongs to another task or another session, ask the owner's OK before expanding it and take the
line back out when the review closes. **If the scope edit is also denied, or the owner doesn't authorize the
expansion: stop.** Tell the owner which verdicts were left unwritten and leave the decision to them; don't write through
the shell or any other path that circumvents the gate. All of this also applies to `refutados.json` and
`mesmos.json` of Step 3.

**Tell the user how many agents ran.** Cost is their information, not your detail.

## Step 3 — tally by script, never by judgment

    node "${CLAUDE_PLUGIN_ROOT}/scripts/apurar-ronda.js" --arquivo '<caminho>'

The `--arquivo` is the same as in Step 1 and chooses its base. Without it, the script finds the base by itself if
there is only one; with more than one, it stops with an error that lists the files.

Who decides whether the round was dry is the script, not you. A round is dry when no finding holds it (keeps it
open): below, "holds the round" means the finding counts against approval, and "does not hold" means it does not. Paste its output into the response.
When the rounds had photos, the output brings `telas` (`antes` and `depois`: address, time, hash, HTTP status and how
many console entries, page errors and accessibility items each photo recorded, from the last round with photos): it
is the screen evidence of the close-out, so keep it in the answer that closes the review.

- **The script checks which lenses voted.** The `mapa.json` carries the band: round 1 without some lens of the band (in
  `completa`, with fewer than 7 known lenses) stops with `ERRO`, like a round without a verdict, and so does a round where a
  lens that found P0, P1 or P2 `erro` in the round before (a finding in `novos`) didn't come back. A missing lens of the
  band: dispatch it with its round-1 briefing and run again. A lens that found an `erro` and didn't come back: dispatch
  it again in this round to say whether its finding is still on the new side, or, if the source disproves the finding,
  put it in `refutados.json` (below) with the proof; then run again.
- **A finding outside the format** (severity that is not P0, P1 or P2; no `arquivo:linha`) is discarded and does not hold the
  round. When the review approves with any, the `motivo` says how many: read `vereditosDescartados` before calling it
  approved. A discarded P0 or P1 that is a real defect gets fixed, and the file goes through a new review.
- **Every finding has a state.** `confirmado` carries the severity and the `trecho` copied from the cited file; the
  script looks for it in that round's `A.txt`/`B.txt`, on the cited line or up to 2 around it, and the one that is not there
  goes to `trechoNaoConfere` and to `vereditosDescartados` without holding the round. `pendente` carries no severity, only the
  exact fact that is missing (`falta`): it goes to `pendentes` and does not hold the round either. Read both lists: a
  pendente that the source confirms, or a discarded trecho that points to a real defect, gets fixed like any P0/P1. A
  finding with no state invalidates the whole verdict (`ERRO`): write it again. Rejected is `refutados.json`, below.
- **Every confirmed P2 says its `tipo`** (`erro` or `melhoria`). A verdict with a P2 without it invalidates like one
  with no state (`ERRO`, and the hook does not write it). Dispatch that lens again, with the same briefing and the
  warning that names the missing field, or complete the field yourself with `"erro"`, the value that holds the round.
  Never write `"melhoria"` yourself: you wrote what is under review, and that mark is the inspector's.
- **The `seguranca` lens names the boundary.** Its `confirmado` P0/P1 carries `fronteira` (`entrada`, `controle`,
  `efeito`) and its `pendente` carries `plano` (how to check the missing fact without risk). A verdict without them
  invalidates like one without `trecho` (`ERRO`, and the hook does not write it): dispatch that lens again, with the
  same briefing and the warning that names the missing field (the format is in `agents/inspector.md`), instead of
  writing the fields yourself.
- **Only the new side holds the round.** The script reads the `mapa.json` of each round: a P0/P1 cited on the old
  side (what the change fixes, or what already existed) goes to `achadosDoLadoAntigo` — information, not a
  block. You still don't open `mapa.json`: the script reads it.
- **What does not hold the round goes to `registros`** (owner's decision, 2026-11-10). Each one says why in
  `registro`: `melhoria` is a P2 the inspector marked `tipo: "melhoria"`, in any round; `linha nova` is, in rounds 2
  and 3, a finding on the new side more than 2 lines away from every line the fix changed and from every line cited
  before; `fora da mudanca` is, in round 1, a finding on the new side more than 2 lines away from every line the
  change touched against HEAD (what already existed, out of scope: it is recorded, not fixed), except for the
  `escopo` and `correcao` lenses: a missing piece of the request, or a regression in a caller of what changed, may
  sit where nothing changed. The script measures the change itself, comparing
  the new side of the round with the one before (in round 1, with the HEAD side); when it cannot measure it, the
  finding holds the round as usual. None of these kinds holds the round or counts as open. When the review closes
  with any, the `motivo` says how many: copy each one to the record of the plan in the close-out.
- **What held a round and came back the same is still open.** A finding that held an earlier round and comes back
  with the same key (same severity, lens and line, on the same side of the change: work or HEAD as `mapa.json` says,
  not the A/B label; reworded text is still the same key) is not new and does not hold the round, but you dispatch
  its lens again in the next round, as a lens that found an error (in both passes, with a reference), and the review
  does not approve while one came back in the last round: the output lists them
  in `achadosAindaAbertos` and the `motivo` says how many. Before the cap, fix each one or refute it in
  `refutados.json`; at the cap they are handled with the other open findings, by the cap row of Step 5.
- **The detector is crossed after the verdicts** (style file with `design.json`). `detector` in the output splits
  the last round in three: `lenteEDetector` (both saw it), `soDetector` (the detector saw a value outside the
  system that the `ui-design` lens did not cite) and `soLente`. Each `soDetector` item is a finding to settle: swap
  the value for one of `design.json`, or ask the owner to declare a deviation for this screen in `desvios` of
  `design.json`; it does not fail the round, and the `motivo` of the close says how many.
- **The screen inventory says what the change dropped** (`.html`, `.htm`, `.jsx`, `.tsx`, `.vue`, `.svelte` with a
  HEAD side). `inventario.json`, in the round and hidden from the inspectors, lists what the HEAD side wired (id,
  event, link, form field, test hook, script, form action and, when the round has the `--tela-antes` and
  `--tela-depois` photos, the accessibility names). The `motivo` of the close says "mantido N/N" and how many items
  were dropped; the list is `inventario.sumiram` in the output. A dropped item does not fail the round, but each one
  is settled before calling it done: put the element back in the file, or declare in a comment of the file
  `sworn-dispensa: <item> -- <reason>` with the item exactly as listed and a reason of 12 letters or more (the
  marker outside a comment waives nothing).
- **A finding refuted at the primary source** goes in `refutados.json`, in the file's base (the `base` folder
  of the output of Step 1):
  `[{ "ronda": 2, "lente": "design", "arquivo": "B.txt", "linha": 471, "severidade": "P1", "prova": "<why, citing arquivo:linha>", "simbolo": "<text on that line>" }]`.
  The `severidade` is the finding's: refuting the P1 of a line doesn't take down the P0 of the same line. Without `prova`
  or without `severidade`, the script stops with an error. **The script checks the proof**: `prova` cites an
  `arquivo:linha` of the repository (relative to where you run the command) and `simbolo` is text the script finds on
  that line or up to 2 around it; when the proof is a command you ran, put it in `comando` instead of `simbolo`. A
  refutation whose proof does not check stops the tally with `ERRO`: fix the cited line or the `simbolo` in
  `refutados.json`, or remove the refutation if the source does not prove it, and run the tally again. The output
  lists the refuted ones for the owner to check.
- **With a reference**, the output brings `referencia` (without it, `null`): `lentes`, each with `ordem1`, `ordem2` and
  `resultado` (`vence`, `empata`, `perde` or `incompleta`, by the last round that called it); `lacunas` of the new
  side; `lentesAtras` (those that lose, are incomplete or have a P0/P1 gap); and `pronta`. A finding of the 2nd pass
  comes out with `passada: 2`: its `A.txt` is another file, so its refutation carries `"passada": 2`. A gap refuted
  at the primary source goes in `refutados.json` like a finding, with `"lacuna": true` and the gap's `ronda`,
  `lente`, `arquivo`, `linha`, `severidade` (and `passada`): it leaves `lacunas` and stops holding `pronta`. You
  dispatch the 2nd pass (A and B swapped) with the same lenses as the 1st: in round 1, every lens of the `faixa`
  (Step 2); in a later round, every lens that found an error in the round before. When either pass lacks one
  of them, the script stops with an `ERRO` that names the round, the pass and the missing lens.
- **Neighboring findings may be the same defect.** The output lists in `paresCandidatos` the nearby pairs (up to 10
  lines apart) and in `paresFortes` those on the same line. If `paresFortes` is not empty, dispatch **one**
  `sworn:dedupe-judge` subagent with that list (with more than 50 pairs, batches of up to 50, one subagent per
  batch, in the same burst). The other candidates do not go to the judge: measured on 79 closed reviews, the same
  line held 49 of the 58 pairs the judge called the same defect, with 85 pairs to judge instead of 365. Write what it returns to `mesmos.json`, in the same folder as `refutados.json`, with
  Write: `[{ "novo": "<chave>", "outro": "<chave>", "resposta": "sim" }]`, and run the script again. The output then
  brings `provaveisMesmos`. **Nothing in the count changes:** the new finding still holds the round. If it is a repeat
  of something already fixed, prove that at the source and use `refutados.json`; the judge's word is not proof. A judge that
  fails or doesn't answer: proceed without `mesmos.json`, and the output is the usual one.

When the review **closes**, the script itself counts one `revisao_fechada` — it is the countable trigger for
a chat switch, and nothing else in the plugin increments it. It discovers the session by itself; pass
`--sessao <id>` only if you need to force it (the id carries only letters, digits, `_` and `-`; with no value or with another
character, the script stops with an error). The output brings `revisaoFechadaContada` for you to check.
Running the script again on an already closed review **does not count again**: the close-out is recorded in the
base (`fechada.json`) and the output says it was already counted. Preparing again a file whose review has already
closed starts a **new review**: `preparar-revisao.js` moves the whole base to
`.claude/sworn/revisao-fechada/<arquivo>/<carimbo>/` (nothing is deleted; the output gives the destination in
`arquivada`) and the round goes back to 1, with the full cap of 3. The new review's close-out counts again. A review
left open (no `fechada.json`, for example the cap spent and the commit going ahead) is archived the same way when the
file in HEAD is no longer the version its last round judged: each round records that version in its `mapa.json`
(`headDoArquivo`). A review folder written before 0.47.0 has no such record; it is archived when the file's latest
commit is dated in a later second than the newest file in that review folder. Either way the output adds
`arquivadaAberta: true` next to `arquivada`. Nothing to do about it: the archived rounds judged an older HEAD, and
the new review at round 1 judges the current one.

## Step 4 — following rounds

- **Round 1 discovers; the following ones verify.**
- Round 2 calls **only the lenses that found P0, P1 or P2 `erro`** (the ones with a finding in `novos`), with the
  briefing reformulated as a specific question about its own finding. Order of magnitude, in the `completa` band:
  **10 → 4 → 2**.
- **An open P2 `erro` holds the review, like a P1; a P2 `melhoria` never does** (owner's decisions, 2026-11-09 and
  2026-11-10). The inspector marks each P2 `tipo`: `erro` when it affects how the thing works, security, what the
  user sees, or can lose data; `melhoria` when it is only a simple improvement with none of those effects; without
  the mark the verdict is invalid (Step 3). Fix the `erro` before the next round, or take it out with a refutation: with proof
  (`simbolo` or `comando`), or, for a P2 only, with `foraDoPedido` saying why it is outside the request (text of
  another change, a design the owner decided). Never by silence. A refuted P2 (by proof or `foraDoPedido`) no longer
  counts as open. A P2 `melhoria` goes to `registros` from round 1 on (Step 3): it needs no fix and no refutation.
- **Rounds 2 and 3 only verify.** In them, a finding holds the round only on a line the fix changed, on a line
  cited before, or up to 2 lines from one of those; anywhere else on the new side it goes to `registros` as
  `linha nova` (Step 3). Their briefing says so: after the usual lines, it says in one or two sentences what changed
  since the previous round, lists the lens's own P0, P1 and P2 `erro` of that round (each with its `descricao` and
  `comoFalha`), and asks, for each one, whether it is still present or fixed. A finding of the round is only a listed
  defect still present, or an error in what changed; the briefing never asks the inspector to look at the rest. A lens
  called back with no error of its own (the correctness one when no lens found an error) gets the same form with the
  list empty: it confirms there is no error in what changed. A lens of `referencia.lentesAtras` is the exception: it
  judges against the reference again, with its usual briefing.
- **Rounds 2 and 3 run one step below round 1** (owner's decisions, 2026-11-10 and 2026-11-12): checking a named defect does not
  need the model that discovers. In Claude Code, the judge gate (`scripts/portao-juiz.js`) sets the model from the
  round in the verdicts folder path of the briefing: round 1 one step above the session's model, rounds 2 and 3 one
  step below that (with the session on Opus: Opus in round 1, Sonnet in rounds 2 and 3). So every briefing keeps that
  path, with its round number, as Step 2 says. Without the gate (another harness, or `"juizAcima": false`), dispatch
  rounds 2 and 3 one step below the inspector's own model (Sonnet becomes Haiku).
- With a reference, it also calls the lenses of `referencia.lentesAtras`, in both passes.
- If no lens found P0, P1 or P2 `erro`, the next round calls **at least one** (the correctness one): a round with
  no verdict at all is not a dry round, and `apurar-ronda.js` stops with an error.
- Before each new round, fix what the previous one found and run `preparar-revisao.js` again.

## Step 5 — stopping

`apurar-ronda.js` says when to stop.

**Round 1 approves by itself** when every lens of the band voted and no verdict brings a finding other than a
`melhoria`: no `pendente` and no other `confirmado` (not even one on the old side or one outside the format). A
P2 `melhoria` on the new side goes to the record and does not hold the round (a P0 or P1 marked `melhoria`, or one on
the old side, still does). The `motivo` is
`ronda 1 completa sem achado nenhum: aprovado`, or `ronda 1 completa so com melhoria (vai ao registro): aprovado`,
and there is no round 2. With any other finding, round 2 runs as usual.
With a reference, it also takes `referencia.pronta` and no gap at all in `lacunas`. A base prepared by an older
version, whose `mapa.json` has no band, still needs two dry rounds.

With a reference, two dry rounds only approve when every lens ties or beats the reference in both orders,
with no P0/P1 gap on the new side (`referencia.pronta`). **Reference not reached** is the opposite: some lens
falls behind it in one of the orders, or a P0/P1 gap remains. Before round 3, the review has not ended: the `motivo`
lists the lenses that fell behind, and the next round calls them. In round 3, it is the cap.

Three possible outcomes:

| `motivo` | What you do |
|---|---|
| two dry rounds, or round 1 complete with no finding other than a P2 `melhoria` (with a reference: and `referencia.pronta`) | Approved. Close by saying how many agents ran, in how many rounds, and copy `registros`, if any, to the record of the plan |
| cap of 3 rounds with P0, P1 or P2 `erro` open, or the reference not reached | **Do not ask, and do not open a new review.** Fix what is an error, each fix with a test that fails when the code is broken on purpose. Optional, once per review: after the fixes, `preparar-revisao.js --arquivo <file> --conferencia` prepares one conference round with only the findings that held a round open and only their lenses; each inspector answers per `id`, and `apurar-ronda.js` approves when all are fixed. Run the whole suite and wait for green. Then commit with `# sworn: sem-revisao` at the end of the command: the commit gate names the files closed at the cap and asks for that mark. Write what stays open, and `registros`, in the record of the plan |
| hasn't ended yet (includes the reference not reached before round 3) | Fix and run the next round, with the lenses the `motivo` lists |

## Step 6 — what was not inspected

The close-out lists **every changed file in scope that did not go through this review**, and why
(cost choice, generated file, outside the family of lenses). A new file goes through, with one side
empty: say that in it the blindness does not exist. A renamed file keeps its old side only when git sees the
rename (`git mv`, or `git add` on both names); after a plain `mv` it comes out as new, so stage the rename
before preparing, or say in the close-out that the old side was missing. Silence about what was not
inspected is the same as saying it was.

## What this review does not do

- **It doesn't judge whether the interface came out nice.** Without the photos (`--tela-depois`), the visual lens answers "does it overflow?" and doesn't
  answer "is it good?". With the photos it sees the screen, but at one width and one state: the one the address opened.
  Said now, not discovered at the end.
- **The blindness is partial.** Line count and a fix comment give away which side is the new one.
  That is why the A/B score is a **signal**, and the finding with `arquivo:linha` is the **proof** — it holds up
  even if the inspector guessed the sides.
- **It doesn't expand the request.** A P2 `erro` is fixed when it is part of what was requested; one outside the request
  leaves with `foraDoPedido` and its reason, and a P2 `melhoria` becomes a record in any round. Maximum quality
  applies to what was requested, never to expanding the request.
