# Blind inspection protocol

The rite that turns "review" into a verdict with evidence.

---

## 1. Prepare the material

**Baseline (the comparison standard).** Always two elements, named in the answer:

1. the literal values of the declared ruler — `{{texto:reguaDeComparacao}}`;
2. the sibling artifact with the best finish that is **already approved** — `{{texto:artefatoDeReferencia}}`.

If the project declared neither, **tell the inspector so**. It then judges internal consistency, and
the verdict comes out marked "no external ruler". An inspector with no baseline that doesn't know it
has none invents one, and its baseline is never yours.

**Artifacts.** For a visual change, generate the images per viewport before and after. For a code
change, the diff and the touched files.

### Artifact integrity — check BEFORE dispatching

A mutilated artifact produces an invalid verdict, and the inspector has no way to know it was
mutilated. It reports the cut as if it were a code defect, and its vote contaminates the whole round.

**Rule: hand over the whole file.** Comparing two versions? `git show HEAD:<path>` on one side, the
file on disk on the other. No slicing. The exception is the cut that `/sworn:review` makes by itself
on small bands: it marks each gap, keeps the line numbers and warns the inspector.

**If you need to slice** — file too big, or the target is an isolated stretch — then, before
dispatching:

- the slice starts and ends on a **function boundary**, never in the middle of one;
- the **same** logical boundary on both sides (not the same line: the new version is longer, and
  cutting both at `[224..350]` decapitates the new one);
- check that every function cited in the brief is **complete** in the slice;
- tell the inspector it is a cut, and of what scope — so it reports "can't see" instead of
  "absent".

**Blinding.** Before handing over to the inspector:

- rename to `A` and `B`, with no "before"/"after", no version number, no date in the name;
- **alternate the order** between inspectors — `A` is not always the same side;
- remove from the brief any mention of authorship ("I implemented", "my change", "the new one");
- don't say which result is expected.

An inspector that knows which side is the "new" one confirms the work instead of judging it.

### What blinding does not hide

Blinding is partial, and pretending it is total leads to trusting the score too much:

- **Line count.** The side that gained code is bigger. 667 against 631 gives the game away to whoever
  notices.
- **A comment that describes the fix.** A `// isso ficava girando para sempre` says which side is the
  after. It is not a reason to remove the comment from the code — it is a reason not to trust the
  vote blindly.
- **Reading the live repository.** If the inspector opens the file on disk, it sees which variant is
  there.

### The prohibition, and the exception that makes it useful

**Explicitly forbid:** opening the repository's code files, reading the commit history, opening the
plan, handoff or decision log. Doing any of these **invalidates its verdict**.

**Explicitly allow, and tell it to use:** the reference documents that define the ruler. The
inspector needs them to judge against something other than its own taste. Forbidding everything in
bulk produces an inspector with no criteria, which is the same as a useless inspector.

**Warn when the reference source is frozen on purpose.** If the ruler is deliberately behind the
code — because a migration is under way, for example — and nobody warns, the inspector reports the
whole lag as a finding, and the round turns into noise.

Practical consequence: the A/B score is a signal, **not proof**. What counts in the verdict is the
finding with `arquivo:linha`, which stands on its own. A "MELHOR: B" with no cited finding is worth
nothing — and a well-evidenced finding is worth something even if the inspector guessed the sides.

---

## 2. Dispatch the lenses

One lens per inspector, **distinct lenses**, never copies of the same reviewer. There are two
families: the eight screen lenses, with list and criteria in [02-rubrica-aaa.md](02-rubrica-aaa.md),
and the ten code lenses of `/sworn:review`. Only the lenses that apply to the type of change — table
at the end of that file.

Each inspector receives: the A/B artifacts, its lens (just one), the named baseline, the prohibition
and the exception from §1, and the instruction to **try to fail it**. The inspector's default is to
find a problem, not to approve.

---

## 3. Verdict format

```
LENTE: <nome>
VEREDITO: APROVADO | APROVADO COM RESSALVA | REPROVADO
MELHOR: A | B | empate  (só quando há comparação lado a lado)
ACHADOS:
  - [P0|P1|P2] <descrição> — evidência: <arquivo:linha> ou <viewport + coordenada do print>
```

**Anti-theater rule.** A verdict without a finding cited with evidence **does not count in the
round's tally**. Praise is not a result. If the inspector found nothing, it says what it looked for
and where it looked.

---

## 4. Convergence

- **Dry round** = no new finding of severity **P1 or above**.
- **Two consecutive dry rounds** → approved. The loop ends.
- **Cap of 3 rounds.**
- Third round with **P0 or P1 open** → **stop**. Take it to `{{campo:quemDecide}}` with three options
  (format in `SKILL.md` §7) and record what is left in `{{texto:ondeRegistrar}}`.
- **P2 never reopens a round.** It becomes a record, not a fix.

Between rounds: fix only P0 and P1, and only within the requested scope. Fixing P2 is the start of
the scope creep that the guardrails forbid.

### When the fix becomes the defect

If the round N finding hits **the fix made in round N-1**, the loop stopped converging and turned
into a sequence of patches. Hard signal: it happened two rounds in a row.

**The way out is not one more round.** It is to stop fixing and run **a single adversarial sweep over
the cause** — enumerate the whole class of the defect before writing the next line of fix. A
3-round rite that becomes a 12-round one didn't discover more things: it discovered its own design,
late.

If it still doesn't close, that is a decision for `{{campo:quemDecide}}`, with three options — and
one of them is always "close with the defect recorded and not fixed".

### Narrow the following rounds — round 1 is the expensive one

Round 1 runs **all** applicable lenses: it is the one that discovers. The following ones **verify**,
and verifying is cheaper than discovering.

**Round 2+ calls only the lenses that had a P0/P1 finding against the work itself.** A lens that only
reported a pre-existing defect, or that approved with no caveat, doesn't come back.

Order of magnitude for a small change: 8 in round 1, 4 to 5 in round 2, 2 to 3 in round 3.
Repeating 8 in every round is ~24 agents for a 40-line target — disproportionate, and the evidence
doesn't improve.

**Rewrite the brief of the lens that relapses.** If lens 4 found a stuck state attribute, its round 2
doesn't ask "inspect accessibility" again: it asks to **trace the attribute's lifecycle in every
execution path, with the line numbers of each set and each reset**. A specific question returns a
verifiable answer; a generic question returns the same opinion as the previous round.

**Declare the total to the user.** How many agents per round, and how many in total.

### A repeated finding does not reopen a round

A lens that restates in round 2 the same finding from round 1 — same evidence, same `arquivo:linha` —
does **not** make the round wet. A dry round is the absence of a **new** finding of P1 or above.

Without this rule the loop never converges: an out-of-scope finding, correctly recorded and correctly
not fixed, would reappear in every round and consume the cap of 3 by itself.

A finding that **comes back with different evidence** is new. A finding that comes back identical is
the same finding.

---

## 5. The lens can get the measurement wrong, not just the judgment

A lens's opinion **does not beat your own measurement** — even an expensive lens, even a finding
marked P0.

An inspector that counts occurrences, measures width or asserts coverage is **measuring**, and a
lens's measurement has the same defect as any gauge: it may be counting the wrong thing. Before
accepting a number that comes from an opinion, reproduce the number. If it diverges, **the instrument
is the first suspect** — see the gauge rule in [04-verificacao.md](04-verificacao.md).

This is not distrust of the model: it is the same rule that applies to any new tool.

---

## 6. What to report to the user

- how many rounds ran and why it stopped (2 dry / cap reached);
- **how many agents ran per round** — cost is information;
- P0/P1 findings fixed, with the diff;
- P2 findings recorded, with the path of the record;
- what was **not** inspected and why.

---

## 7. Reference script

Template for a subagent orchestrator. Adjust the lenses to the type of change; **don't** run all
eight when only four apply.

```javascript
export const meta = {
  name: 'inspecao-cega-aaa',
  description: 'AAA Standard blind inspection loop - distinct lenses, cap of 3 rounds',
  phases: [{ title: 'Inspect' }, { title: 'Consolidate' }],
}

const LENTES = [
  'design-system', 'estados', 'responsividade', 'acessibilidade',
  'microcopy', 'anti-referencias', 'regressao', 'governanca',
]

const VEREDITO = {
  type: 'object',
  required: ['lente', 'veredito', 'achados'],
  properties: {
    lente: { type: 'string' },
    veredito: { enum: ['APROVADO', 'APROVADO_COM_RESSALVA', 'REPROVADO'] },
    melhor: { enum: ['A', 'B', 'empate', 'nao_aplica'] },
    achados: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severidade', 'descricao', 'evidencia'],
        properties: {
          severidade: { enum: ['P0', 'P1', 'P2'] },
          descricao: { type: 'string' },
          evidencia: { type: 'string' },
        },
      },
    },
  },
}

const vistos = new Set()
const historico = []
let secas = 0

for (let ronda = 1; ronda <= 3 && secas < 2; ronda++) {
  phase('Inspect')
  const vereditos = (await parallel(LENTES.map((lente, i) => () =>
    agent(
      `Inspect artifacts A and B through the lens "${lente}".\n` +
      `You do NOT know which one is the previous one. Shuffled order: ${i % 2 ? 'B first' : 'A first'}.\n` +
      `Baseline: the ruler declared by the project + the approved reference artifact.\n` +
      `Criteria: the section of your lens in the rubric of the eight screen lenses.\n` +
      `FORBIDDEN to open the repository's code files, commit history, plan or handoff.\n` +
      `ALLOWED and recommended: read the reference documents that define the ruler.\n` +
      `Your default is to FAIL it. Every finding cites arquivo:linha or viewport+coordinate.\n` +
      `A finding without cited evidence does not count.`,
      { label: `round${ronda}:${lente}`, phase: 'Inspect', schema: VEREDITO }
    )
  ))).filter(Boolean)

  const novos = vereditos
    .flatMap(v => v.achados.map(a => ({ ...a, lente: v.lente })))
    .filter(a => !vistos.has(`${a.lente}|${a.evidencia}`))

  novos.forEach(a => vistos.add(`${a.lente}|${a.evidencia}`))
  historico.push({ ronda, vereditos, novos, agentes: vereditos.length })

  const bloqueantes = novos.filter(a => a.severidade !== 'P2')
  secas = bloqueantes.length === 0 ? secas + 1 : 0
  log(`Round ${ronda}: ${novos.length} new findings (${bloqueantes.length} blocking), ${secas} dry in a row`)
}

phase('Consolidate')
const todos = historico.flatMap(h => h.novos)
return {
  rondas: historico.length,
  agentes: historico.reduce((s, h) => s + h.agentes, 0),
  aprovado: secas >= 2,
  bloqueantes: todos.filter(a => a.severidade !== 'P2'),
  registrar: todos.filter(a => a.severidade === 'P2'),
}
```

The script **fixes nothing**. It produces the verdict. The P0/P1 fix happens between rounds, in the
normal flow, respecting the guardrails.

---

## 8. No orchestrator available

The rite doesn't depend on the tool. Mandatory fallback: dispatch the lenses as individual subagents
in parallel, in a single burst, apply the same blinding and convergence rules by hand, and **record
that the loop ran in manual mode**.

If the harness forbids subagents without an explicit request, that is **not** the skill forbidding —
it is the environment. In that case: ask for authorization, or declare the loop **not run**. Never
declare approved a rite that didn't happen.
