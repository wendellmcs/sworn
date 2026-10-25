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

    node "${CLAUDE_PLUGIN_ROOT}/scripts/preparar-revisao.js" --arquivo <caminho> [--completa]

The script writes `A.txt`, `B.txt` and `mapa.json` in `.claude/sworn/revisao/<arquivo>/<n>/`: each
file has its own base, and `<n>` is its round. The `<arquivo>` is the file id: each `/` in the path
becomes `__`, each character outside letters, digits, `.`, `_` and `-` becomes `_`, and an id made only of digits
gets a `_` in front (rule of the `idDoArquivo` function, in `scripts/lib/cegar.js`). The
exact path comes in the output (`a`, `b`, `vereditos` and `base`); use what the output says, don't rebuild it.
**You don't open `mapa.json`, and no inspector receives its path.**

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
blank and the first of each gap says `[fora do trecho: linhas a-b]`.

## Step 2 — round 1: the change band, then the lenses of the right family

**First the band: the review is proportional to the diff** (owner's decision, 2026-10-12). The output of Step 1 brings
`faixa`, `lentes` and `linhasMudadas` (the larger side of the diff against HEAD: lines removed or added).
The lenses of each band are in `scripts/lib/veredito.js` → `lentesDaFaixa`.

| `faixa` | When | How many inspectors |
|---|---|---|
| `uma` | up to 3 changed lines: only a comment, a number or a short phrase | **1**: `correcao` |
| `duas` | up to 40 lines of logic, with a red test and mutation already run | **2**: `correcao` and `borda` |
| `texto` | text (`.md`, `.markdown`, `.txt`) with more than 3 changed lines | **2**: `correcao` and `microcopy` |
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
| Logic only (not style and doesn't build a screen) | **7** | `scripts/lib/veredito.js` → `LENTES` without those in `SAEM_SO_LOGICA` (`design`, `medidor`, `escopo`) |
| Code only | **10** | `scripts/lib/veredito.js` → `LENTES` |
| Screen only | **8** | `scripts/lib/veredito.js` → `LENTES_UI` |
| Code and screen | **18** | both lists |

**The change touches a screen** when the declared scope includes a style file
(`scripts/lib/design.js` → `ehArquivoDeEstilo`) or markup that the project renders.
When in doubt, **both families** — the stricter gear wins.

**A logic-only file** — one that is not style and doesn't build a screen — skips the `design` lens (owner's
decision, 2026-09-29) and, since 2026-10-11, also `medidor` and `escopo` (in round 1 of 41 reviews, 11 of 13 and
5 of 6 of their findings were refuted at the source): that is 7 inspectors, the ones in `LENTES` without those in
`SAEM_SO_LOGICA`. When in doubt, the 10 — they only leave out when it is clear the file is not style and doesn't
build a screen.

**Lens `enxuto` (code that didn't need to exist, since 0.9.0)** — born under observation, because a lens
that judges "too much" was already refuted at the source in 5 of 6 findings (`escopo`). **Exit rule:** after 10
reviews with it, if 2 of every 3 of its findings were refuted at the source, it goes into
`SAEM_SO_LOGICA` and leaves the logic-only file, like `escopo`. Validation at the boundary, data loss,
security and accessibility are never excess: a finding of its against these is refuted. A deliberate shortcut,
with the comment `atalho: <o que>. limite: <até onde vale>. trocar quando: <gatilho>.`, is declared
debt, not excess; the ones that don't carry the trigger are listed by `/sworn:shortcuts` — run it before a release.

Read the lenses from the file, **not from memory**. Dispatch them all in the same burst, **one `sworn:inspector`
subagent per lens**.

Briefing of each one, exactly in this form:

> Your lens is **<titulo>** (`<chave>`): <pergunta>.
> Read only these two files: `<caminho de A.txt>` and `<caminho de B.txt>`.
> Also read `<caminho de regua.md>`: it is the project's ruler. A finding about a value outside the ruler cites the ruler's value.
> Verdicts folder: `<caminho de vereditos>`. Don't open it: copy the path, untouched, into the `vereditos` field of the JSON, and put the lens key (`<chave>`) in the `lente` field.
> Don't open the repository. Don't open `mapa.json`. Return only the JSON of your format.

When the output of Step 1 brings `trecho`, add to the briefing, right after the line with the two files:

> A and B are excerpts: only the changed excerpt, with margin. The line `[fora do trecho: linhas a-b]` marks what was left out, and the blank lines after it are that gap. The gap is not a defect: if the answer depends on what is outside, say "I can't see it", and that finding is at most P2.

The ruler line only goes in when the output of Step 1 brings `regua` with a path. When it brings
`semRegua`, tell the user the review ran **without a project ruler** — the inspector judged by
common sense, not by the declared system.

**With a reference** (the output of Step 1 brings `referencia`), add to the briefing, after the ruler line:

> Also read `<caminho de R.txt>`: it is the top reference, named (it is not A or B). Judge each side against it and return `vsReferencia` and `lacunas`, as your format says.

And dispatch the **2nd pass**: the same lenses again, one subagent per lens, with the same briefing swapping
the two files for `invertida.a` and `invertida.b` and the verdicts folder for `invertida.vereditos`
(`<ronda>/invertida/vereditos`). It is the swapped A/B order: against the reference, only what repeats in both
orders counts (owner's decision, 2026-10-13). The two passes can go in the same burst. **The cost doubles**: each lens runs
twice; tell the user that along with the number of agents.

**The hook writes** (`scripts/gravar-veredito.js`, on the inspector's `SubagentStop` and on the subagent's handback): it
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

    node "${CLAUDE_PLUGIN_ROOT}/scripts/apurar-ronda.js" --arquivo <caminho>

The `--arquivo` is the same as in Step 1 and chooses its base. Without it, the script finds the base by itself if
there is only one; with more than one, it stops with an error that lists the files.

Who decides whether the round was dry is the script, not you. Paste its output into the response.

- **The script checks which lenses voted.** The `mapa.json` carries the band: round 1 without some lens of the band (in
  `completa`, with fewer than 7 known lenses) and a round with some lens that found P0 or P1 and didn't come back stop with
  `ERRO`, like a round without a verdict. Write the missing vote and run again.
- **A finding outside the format** (severity that is not P0, P1 or P2; no `arquivo:linha`) is discarded and does not wet the
  round. When the review approves with any, the `motivo` says how many: read `vereditosDescartados` before calling it
  approved. A discarded P0 or P1 that is a real defect gets fixed, and the file goes through a new review.
- **Only the new side wets the round.** The script reads the `mapa.json` of each round: a P0/P1 cited on the old
  side (what the change fixes, or what already existed) goes to `achadosDoLadoAntigo` — information, not a
  block. You still don't open `mapa.json`: the script reads it.
- **A finding refuted at the primary source** goes in `refutados.json`, in the file's base (the `base` folder
  of the output of Step 1):
  `[{ "ronda": 2, "lente": "design", "arquivo": "B.txt", "linha": 471, "severidade": "P1", "prova": "<arquivo:linha ou comando>" }]`.
  The `severidade` is the finding's: refuting the P1 of a line doesn't take down the P0 of the same line. Without `prova`
  or without `severidade`, the script stops with an error. The output lists the refuted ones for the owner to check.
- **With a reference**, the output brings `referencia` (without it, `null`): `lentes`, each with `ordem1`, `ordem2` and
  `resultado` (`vence`, `empata`, `perde` or `incompleta`, by the last round that called it); `lacunas` of the new
  side; `lentesAtras` (those that lose, are incomplete or have a P0/P1 gap); and `pronta`. A finding of the 2nd pass
  comes out with `passada: 2`: its `A.txt` is another file, so its refutation carries `"passada": 2`.
- **Neighboring findings may be the same defect.** If the output brings a non-empty `paresCandidatos`, dispatch **one**
  `sworn:dedupe-judge` subagent with the whole list (with more than 50 pairs, batches of up to 50, one subagent per
  batch, in the same burst). Write what it returns to `mesmos.json`, in the same folder as `refutados.json`, with
  Write: `[{ "novo": "<chave>", "outro": "<chave>", "resposta": "sim" }]`, and run the script again. The output then
  brings `provaveisMesmos`. **Nothing in the count changes:** the new finding still wets the round. If it is a repeat
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
`arquivada`) and the round goes back to 1, with the full cap of 3. The new review's close-out counts again.

## Step 4 — following rounds

- **Round 1 discovers; the following ones verify.**
- Round 2 calls **only the lenses that found P0 or P1**, with the briefing reformulated as a specific
  question about its own finding. Order of magnitude, in the `completa` band: **10 → 4 → 2**.
- With a reference, it also calls the lenses of `referencia.lentesAtras`, in both passes.
- If no lens found P0 or P1, the next round calls **at least one** (the correctness one): a round with
  no verdict at all is not a dry round, and `apurar-ronda.js` stops with an error.
- Before each new round, fix what the previous one found and run `preparar-revisao.js` again.

## Step 5 — stopping

`apurar-ronda.js` says when to stop.

With a reference, two dry rounds only approve when every lens ties or beats the reference in both orders,
with no P0/P1 gap on the new side (`referencia.pronta`). **Reference not reached** is the opposite: some lens
falls behind it in one of the orders, or a P0/P1 gap remains. Before round 3, the review has not ended: the `motivo`
lists the lenses that fell behind, and the next round calls them. In round 3, it is the cap.

Three possible outcomes:

| `motivo` | What you do |
|---|---|
| two dry rounds (with a reference: and `referencia.pronta`) | Approved. Close by saying how many agents ran, in how many rounds |
| cap of 3 rounds with P0/P1 open or the reference not reached | **Stop.** Take it to the owner with exactly 3 options, the recommended one marked. What is left becomes a record |
| hasn't ended yet (includes the reference not reached before round 3) | Fix and run the next round, with the lenses the `motivo` lists |

## Step 6 — what was not inspected

The close-out lists **every changed file in scope that did not go through this review**, and why
(cost choice, generated file, outside the family of lenses). A new file goes through, with one side
empty: say that in it the blindness does not exist. Silence about what was not inspected is the same as
saying it was.

## What this review does not do

- **It doesn't judge whether the interface came out nice.** Without a screenshot, the visual lens answers "does it overflow?" and doesn't
  answer "is it good?". Said now, not discovered at the end.
- **The blindness is partial.** Line count and a fix comment give away which side is the new one.
  That is why the A/B score is a **signal**, and the finding with `arquivo:linha` is the **proof** — it holds up
  even if the inspector guessed the sides.
- **P2 doesn't become a fix.** A finding outside the scope of the request is a record. Maximum quality applies to
  what was requested, never to expanding the request.
