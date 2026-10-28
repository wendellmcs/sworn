---
name: playbook
description: Portable execution manual for any project. Use at the start of every task that is not pure conversation - implement, fix a bug, plan, review, audit, touch UI, write docs, version, publish, run a long plan. Defines the rigor gear (Fast/Standard/AAA), the inspection lenses (ten for code and eight for screens), the blind-judgment loop with a round cap, the countable chat-switch triggers, the mandatory owner-decision format and what a "done" must prove. Adapts to the project through a declared adapter; without one, it runs in degraded mode and states what it cannot verify. Overrides improvisation; never the user's explicit request.
---

# Universal AAA Standard

## 1. What this skill is, and what it is not

It is the **procedure**: it says which quality gate applies to each task and what evidence proves
the gate passed. **It is not a business rule, and it invents no fact about the project** — every concrete
value (command, color, label, path) comes from the adapter of Step 0-bis.

**Precedence, strongest to weakest:**

1. Explicit and recent human request
2. The canonical sources the project declared — `{{campo:fontesCanonicas}}`, in the order it
   declared them
3. The project skill, if one exists (it knows the domain; this one does not)
4. This skill
5. Default model behavior

**If the project has its own execution skill, it wins over this one on everything that is content.** This
skill yields and does not duplicate.

**Reference by name, never by line.** When citing a governance document, cite the file and the
**section title** — never `arquivo:linha`. A line anchor rots silently and ends up
pointing to an empty line, which is worse than not citing. This holds only for governance documents:
an inspection finding still requires `arquivo:linha` of the **code**, which is verifiable on the spot.

## 2. Step 0 — classify the gear, before reading code

| If the task is… | Gear |
|---|---|
| typo, text, comment, rename, formatting, one-off config — 1–2 files, zero new logic, nothing visible to the user | **Fast** |
| bugfix, feature of clear scope, bounded refactor, new test, documentation | **Standard** |
| user-visible UI; release; contract change between systems; permissions; security; broad refactor; intermittent bug; long plan execution; any item of `{{campo:marchas}}` marked as AAA | **AAA** |

**The gear you classify is a floor, never a cap.** If the project declared a `path → gear` map
(`{{campo:marchas}}`), it **wins** — and always wins upward. The one being
audited does not choose their own level of rigor. With no declared map, `{{campo:marchaPadrao}}` applies;
with neither, the table above applies.

Then set the effort by the gear — the effort only; the model does not change by skill:

- Fast → call the skill `sworn:effort-low`;
- AAA → call the skill `sworn:effort-high`;
- Standard → no level skill: the session effort.

The effort of a level skill lasts only until the end of the turn that called it: the next turn, even in the same chat,
is back at the session effort (measured by sworn on Claude Code 2.1.311). So, in a Fast or AAA task, call the skill of
the gear at the start of each turn of the task (each new message from the user while the task goes on), before any
other tool — not only here in Step 0.

When the gear goes up during the task (the map above, or a change that turned out bigger), call the skill of the new
gear at that moment, and from then on at the start of each turn. From Fast to Standard, Standard has no skill and the
low effort may still be on until the end of the turn: call `sworn:effort-high` in that turn, because there is no skill
that brings back the session effort and more effort than the gear asks is the safe side; from the next turn on, no skill.

Two axes that get confused and are not the same thing:

- **When in doubt between two models, go down** — start with the cheapest. Agents escalate on their own.
- **When in doubt between two gears, go up** — the stricter gate.

A cheap agent can and should go through an AAA gate. Model cost and verification rigor are
independent.

Detail of each gear, with gates and minimum evidence: [01-marchas-e-gates.md](references/01-marchas-e-gates.md).

## 2-bis. Step 0-bis — does this project have an adapter?

**Before applying any gate**, find out what to fill the slices with.

1. **Look**, in this order: `.claude/*/projeto.json` · `.claude/*/adaptador.md` ·
   the project's own execution skill (in `.claude/skills/`, the one that says "Gerado por
   `/sworn:init`"; with more than one like that, ask the owner which one applies; with none like that, the
   handwritten one the project uses as an execution manual, if any — §1 applies to it the same way).
2. **Found it** → use its values. If the project re-injects a short rules file in every session,
   **do not repeat here what it already says** — repeated context is context paid for twice.
3. **Did not find it** → offer to create it, with the five questions no scan answers. Scan
   first, ask later; 3-option format of §7; **never overwrite** an existing adapter.

**The five questions** (the rest is discovered by scanning, and discovered better than by asking):

| # | Question | Fills |
|---|---|---|
| 1 | Is this project internal or public? | `{{campo:modeloDeAmeaca}}` |
| 2 | Which files really rule, and in what order? | `{{campo:fontesCanonicas}}` |
| 3 | Which command proves it is done? | `{{campo:provaDePronto}}` |
| 4 | What must not be touched? | `{{campo:intocaveis}}` |
| 5 | Who decides? | `{{campo:quemDecide}}` |

**The scan fills in on its own, without asking:** `{{campo:plataforma}}` (operating system and shell),
`{{campo:marchas}}` (the `path → gear` map) and `{{campo:marchaPadrao}}`. Asking what
is discovered by looking wastes the patience of whoever answers.

**Judgment slices**, which are not inferred from a scan and so are asked for when first used:

| Slice | What it fills |
|---|---|
| `{{texto:reguaDeComparacao}}` | the literal values to compare against |
| `{{texto:artefatoDeReferencia}}` | the best-finished piece already approved |
| `{{texto:rotulosCanonicos}}` | product names that do not change |
| `{{texto:viewports}}` | the widths the product really serves |
| `{{texto:pontoDeColapso}}` | the width at which the multi-column layout **must** collapse |
| `{{texto:antiReferencias}}` | what this product **must not** look like |
| `{{texto:guardaCorposDoProjeto}}` | guardrails that only apply here, including those that invert this skill's |
| `{{texto:sobreBloqueioAceito}}` | the false positive the owner prefers to a false negative |
| `{{texto:foraDeEscopo}}` | what never enters, by a decision already made |
| `{{texto:ondeRegistrar}}` | where out-of-scope findings and decisions made go |
| `{{texto:ondeHandoff}}` | where the handoff goes |

4. **Degraded mode is declared, never silent.** Without an adapter, this skill still runs: the lenses
   work by reading code, and convergence works the same. What it **cannot** do is
   compare against values nobody declared. **Say which gates cannot be verified here, and
   why, before executing.** The risk was never the absence of the gate — it is the silence about it.

## 2-ter. Step 0-ter — is this project's model map still valid?

**This check runs on the main agent. Never delegate it to a subagent.**
It was measured: the subagent receives from the harness **its own identity**, and **not** the catalog of what
exists. A subagent that "checks" compares against nothing and returns a false green — which is worse than not
checking, because it looks checked.

1. **Read this project's map from disk, never from memory:**

       node "${CLAUDE_PLUGIN_ROOT}/scripts/portao-apelido.js" --mapa

2. **Compare it with the catalog the harness handed you in this session** — the list that arrived along
   with your instructions, not the one you remember having learned.

   ⚠️ **Do not take a model name from a project file.** This was already measured and went wrong: probes
   asked "did you receive the list?" answered yes and pasted the routing table from
   a file of the project itself. In a project whose files name models, the check lies with
   all the confidence in the world.

3. **A divergence here is a smoke detector, not a verdict.** The harness catalog is thin — families
   and identifiers, with no price and no context window — and an outdated catalog has already been measured
   **about the very model that was reading it**. What brings price and capability is a lookup of the manufacturer's
   page; what decides what the divergence means is the owner.

4. **Never write the conclusion into the configuration.** The result of a check is shown as cited
   evidence, never written on its own into `projeto.json`. Changing a nickname is the owner's decision, and goes in
   3 options with the recommended one marked.

5. **No harness catalog in this session? Say so** and carry on. Declared absence is degraded mode;
   silent absence is the hole this manual exists not to have.

**This check is an instruction, and instructions can be skipped.** The guaranteed guard of the ladder is the
gate that compares file with file and runs by itself on every dispatch. This one sees what
no gate sees — and is worth it precisely for that, even though it is not guaranteed.

## 3. PREVC cycle

**Plan** — goal, likely files, risks, acceptance criterion, what is out of scope.
**Review** — read the real context and the rules *before* giving an opinion. Re-read the plan excerpt in the file,
never from memory or from the handoff.
**Execute** — the smallest set of files that solves it.
**Verify** — run what the gear's gate requires, or explicitly declare what did not run.
Output that shows a failure does not verify: fix the cause and rerun what it affects.
**Complete** — summary with evidence, remaining risks and what needs a human.

A simple task uses the same reasoning in compact form. "Fast" never means improvised.

**Each piece when it helps.** sworn has commands for the right moments; offer them there, never on
every task, and run what costs only with the owner's yes:

- request for a new feature or an improvement to the project → `/sworn:radar` (similar public projects);
- AAA gear with no reference that can be opened → `/sworn:reference` (§4.1);
- work written, before calling it done → `/sworn:review`;
- before a release, or when closing AAA code → `/sworn:shortcuts` (shortcut without a swap trigger);
- accumulated skills and rules → `/sworn:audit`; doubt whether the chat-switch threshold fits →
  `/sworn:calibrate`;
- owner correction that holds for next times → `/sworn:learn`.

## 4. The AAA standard

The maximum-quality rite. Four mechanisms, in this order.

### 4.1 The reference is named, never the agent's taste

The comparison standard is the pair declared in the adapter:

- the **literal values** of the project's design system or contract — `{{texto:reguaDeComparacao}}`;
- the **best-finished sibling artifact already approved** — `{{texto:artefatoDeReferencia}}`.

No inspector judges by "I think it looks nice". They judge against these two, citing the value or the artifact.
**If the project declared neither, say so** — and lens 1 now answers only what can
be answered without a ruler: internal consistency. Do not invent a ruler.

**The top reference, named before starting.** In the AAA gear, before doing, name the best piece
that exists for this kind of deliverable, on the market or in the project itself. It has to be something that can be opened
(file, screenshot, repository), never a recollection. The project declares it in `referencias`, in
`projeto.json`, by type (`tela`, `codigo`, `texto`), and `/sworn:review` puts it in the blind package (the
copies A and B, without saying which is the new one) as `R.txt`, the file with its text. Each lens judges
twice: in normal order and in a 2nd pass with A and B swapped, and against the reference only what repeats
in both counts. Done, against it, means tying or winning on each lens,
in both orders, with no P0/P1 gap. With no reference that can be opened, offer `/sworn:reference`: it
studies the leaders of the same type and, with the owner's yes, records the sheet in `referencias`. If it does not fit now,
say "no reference" and use the sibling artifact above.

### 4.2 Distinct lenses, not repeated inspectors

Sending several inspectors at once (the *fan-out*) uses **different lenses**, one per inspector.
Copies of the same reviewer find the same problem several times; distinct lenses find distinct classes of problem. There are two families,
which coexist and do not merge: the **ten code lenses**, in `LENTES`, and the **eight screen
lenses**, below, in `LENTES_UI`, both lists in `scripts/lib/veredito.js` of the plugin. Which ones go
depends on what the change touches: code only, the ten code lenses; screen only, the eight screen lenses; code and
screen, both families; when in doubt, both. That is the `/sworn:review` rule, in the table of Step 2
of `skills/review/SKILL.md`. Before the family comes the band: a small change goes to fewer inspectors, by
diff size, in the other table of the same Step 2.

1. Design system fidelity
2. Required states
3. Responsiveness and overflow
4. Accessibility
5. Microcopy
6. Visual anti-references
7. Correctness and regression
8. Governance and security

Criteria, severity cutoff and which lenses apply to each type of change:
[02-rubrica-aaa.md](references/02-rubrica-aaa.md).

### 4.3 Blind judgment

The artifacts go to the inspector labeled **A** and **B**, with no authorship and no order. They do not know which is the
"before", which is the "after", nor which came from the agent that dispatched them.

**Anti-theater rule:** an inspector who only praises is an invalid inspector. Every verdict cites `arquivo:linha`
or the coordinate and viewport of the screenshot. Without cited evidence, the vote does not count.

**Intact artifact before blinding.** A slice that cuts a function in the middle makes the inspector report the cut
as a defect, and contaminates the round. Deliver the whole file; slice only at a function boundary.

**The blindness is partial.** Line count and fix comments give away which side is the new one.
So the A/B score is a signal, and the **finding with `arquivo:linha` is the proof**.

**The inspector does not open the repository's live code — but CAN and should read the reference
documents.** Opening the file on disk reveals which variant is there and invalidates the verdict; reading the
declared ruler is what makes the verdict verifiable. And when the reference source is
frozen on purpose, **warn them**, otherwise the inspector reports the lag as a defect.

Loop assembly, how to blind and reference script:
[03-inspecao-cega.md](references/03-inspecao-cega.md).

### 4.4 Convergence with a cap

- **Dry round** = zero **new** finding of severity P1 or above. A repeated finding with the same
  evidence does not wet the round.
- **Two dry rounds in a row** → approved.
- **Round 1 discovers; the following ones verify.** Round 2+ calls only the lenses that found P0/P1 against
  the work itself, with the brief reworded as a specific question. Order of magnitude: 8 → 4 → 2.
- **Cap of 3 rounds.** Reached the third with a P0 or P1 open: **stop**, take it to `{{campo:quemDecide}}`
  with three options, and what is left becomes a record in `{{texto:ondeRegistrar}}`.
- **A fix that breaks the previous fix is a sign of design, not of carelessness.** If the finding of
  round N hits the fix made in round N-1, **stop patching**: run a single adversarial sweep
  over the cause before writing more fixes. Patch on top of patch is how a
  3-round rite turns into a 12-round one.

Severity:

| Level | Meaning | Effect |
|---|---|---|
| **P0** | Breaks function, leaks a secret, visible overflow, illegible contrast, permission violated | Blocks delivery |
| **P1** | Required state missing, value outside the declared ruler, microcopy outside the standard, contract regression | Blocks the release |
| **P2** | Real improvement, out of the request's scope | Becomes a record, **does not** become a fix |

Always declare how many agents ran per round. Cost is information, not detail.

## 5. Inviolable guardrails

This is the section that keeps rigor from turning into damage. **It wins over any urge to "make it
perfect".**

- **AAA is the quality of what was asked, never the enlargement of the request.** The scope is the user's.
- **An out-of-scope finding is recorded, not fixed** — in `{{texto:ondeRegistrar}}`.
- **No opportunistic refactoring.** Smallest safe diff. Preserve names, IDs, storage keys and
  load order.
- **Do not delete or revert the user's work** without an explicit request. An obsolete file is **never
  removed: it is retired**, with one line saying date, origin and reason.
  **Before moving, three checks:** (1) `git status` in the repos involved — a file from another
  front is not moved; (2) the plan in execution does not reference the path; (3) file count
  before and after, pasted in the answer. A folder outside git has no safety net: `mv` always, `rm`
  never — **except the source folder that was left empty by the `mv` itself**. Use `rmdir`, never
  `rm -r`: if it is not empty the command fails, and that failure **is** the safety net. Retiring a
  whole project or a backup is the decision of `{{campo:quemDecide}}`.
- **A file already modified in `git status` belongs to another front.** Run `git status --short` before
  editing, do not touch what already shows as modified, and recheck at close-out. See Step -1 in
  [01-marchas-e-gates.md](references/01-marchas-e-gates.md).
- **Do not touch what the project declared untouchable** — `{{campo:intocaveis}}`.
- **Never raise a ratchet baseline** to make the test pass. Removing the cause is the way out; raising the baseline
  is a recorded human decision.
- **No commit, push or release without an explicit request.**
- **No unrequested security change** when the project declared the risk as accepted
  (`{{campo:modeloDeAmeaca}}`). In a public project, or one that **is** a security mechanism, this
  rule inverts — which is why it is a slice, not fixed text: `{{texto:guardaCorposDoProjeto}}`.
- **"Perfect" never justifies a diff larger than necessary.**

If the AAA rite and a guardrail collide, the guardrail wins — and the conflict becomes a decision in the
format of §7.

**A rule that is broken by routine is a defect of the rule.** If a gate keeps being broken with a
record, repeatedly, the problem stopped being discipline and became calibration: take it to
`{{campo:quemDecide}}` with three options, instead of breaking it a third time.

## 6. Context health and chat switch

With continuous mode on (the session opening says whether it is), only the triggers of the paragraph
"Continuous mode", further below, apply.

The drift starts when the plan begins to be executed from memory. **Countable** triggers — **one**
is enough:

- closed a stage or wave of the plan with a commit;
- about to open a new stage that depends on re-reading the plan;
- 2 or more tasks with independent review closed in this conversation;
- 3 or more owner decisions recorded in this conversation;
- 2 or more own measurement or instrument errors in the same conversation;
- the conversation went past 175 thousand tokens of context (the plugin's end-of-turn hook measures and warns, only at the end
  of a turn, never mid-task; above 450 thousand a firm alarm goes out, once);
- any incident that required surgery (git history, environment, concurrent session);
- you could answer about the plan without reopening it;
- the user asked whether the context is fine — the question **is** the answer.

**Triggered? In the same reply, without waiting to be asked:**

1. say outright that it is time to open a new chat, citing which trigger fired;
2. **paste the ready prompt in the chat, in a code block** — saving it to the file is not enough;
3. **do not ask "shall I continue?" before offering the switch.** The switch comes first.

Handoff in `{{texto:ondeHandoff}}`. Mandatory content in
[05-governanca.md](references/05-governanca.md).

**If the doubt "is it time yet?" came up, it already was.**

**Living note.** While a plan task is in progress, write the progress in the plan file as you go (the task's box, or
one line of what is already done), not only at the end: a chat switch in the middle of the task then loses nothing.
With a plan in the session, 5 replies with work without the plan file changing bring the plugin's reminder.

**Always: validate by the agent itself before asking for manual action.** Run the test, open the browser
(Claude in Chrome or CDP), read the result. Ask `{{campo:quemDecide}}` only for what only they can do —
credentials, publishing or deploying, a screen with customer data in their login — and bundle everything into a single request.

**A warning or tip that a hook puts into the conversation has a cap:** it goes out once per session, or only every N times,
never on every call — each repetition goes back in full into the context and competes for attention with what matters.
What already repeats, `/sworn:audit` shows (item 1c).

**Continuous mode (key `modoContinuo` in `projeto.json`).** On by default: only the boolean `false`
turns it off; with no key, with another value or with no file, it stays on. The session opening says whether it is on. When on, only four
things call for a chat switch: the size of the conversation (the warning at 250 thousand, in place of 175 thousand, and the
alarm at 450 thousand); the
gate-blocks warning, which the plugin gives at the end of a turn when the session reaches the threshold (6 by
default; a single block does not call for it); the incident that required surgery; and the user's question about the
context. The other triggers on the list, the doubt "is it time yet?" and the
plugin's counters (closed reviews, owner decisions, commits, turns with work and files
touched), which do not even warn, stop calling for a chat switch. The "Triggered?" paragraph still applies to the triggers that remain, and
"Always" does not change. In exchange: re-read the plan excerpt in the file before each sub-item; a technical choice
within scope is decided, recorded with the reason and listed at close-out; to the owner goes only the
irreversible, the external (publish, push, send), credentials, permission or security, cost and
product matters, in the format of §7.

## 6-bis. Parallel work

An agent running in the background is no reason to stop. The short version of this rule also goes out in the
opening of every session; to turn it off: `"paralelismo": false` in `projeto.json`.

- **Launched a background agent? Carry on with the next task that does not depend on it.** Wait only
  when the next task needs the result. Real dependency is the only reason to wait.
- **Two or more agents editing at the same time: each one isolated** (`isolation: worktree`), otherwise one
  overwrites the other. An agent that only reads needs no isolation.
- **An agent's report is a claim**, not a fact: check the critical part at the source before calling it done.
- **Cost brake:** the cheapest model that solves the task (the project's model map rules);
  at most 8 agents per dispatch. Rigor remains an axis separate from cost.
- **3 or more independent tasks: run `/sworn:parallel` directly**, without asking, and say in one
  line how many agents, which model and the approximate cost. Claude Code only runs a workflow
  on request: the authorization given once in `/sworn:init` is that request; if the tool
  still refuses, tell the owner instead of working around it. Call: the Workflow tool with `name: "sworn:parallel"` and
  `args` = list of tasks (`[{"tarefa": "...", "edita": false}]`). It applies the brake by itself: 8 per
  dispatch (it says which were left out), Haiku for those that only read, Sonnet for those that edit, isolation for
  those that edit, and returns each result with the evidence the agent pasted.

## 7. How to ask the owner for a decision

Every decision that belongs to `{{campo:quemDecide}}`: **exactly 3 options (a, b, c)**, via
`AskUserQuestion` when the harness offers it.

- Recommended **first** and marked.
- Each option says **what happens in practice** — consequence, not description.
- Cost declared when there is one: money, time, risk, rework.
- Simple language. They should not have to reconstruct the technical reasoning to choose.
- **Do not decide alone** what is their choice, and do not hide the choice inside a paragraph.

A decision made goes to `{{texto:ondeRegistrar}}` with date, in the form "do not ask again".

**The size of each option:** still three options, the recommended one first and marked. Each
option fits in one or two sentences, with the practical consequence and the cost inside, in that order — not the
reconstruction of the technical reasoning that led to it. More than two sentences is a sign that the option
hides two choices, and they get separated. Shortening the form never loosens the requirement.

**Visual choice: show the image before asking.** An option described in text does not convey what
is seen, and a choice made without having seen it becomes rework the next day. First send the image (before ×
proposal × reference, or a photographed mock with the real sheet), **wait for the send to confirm** and only in the
next turn make the 3 options, saying in one sentence what the recommended one will **not** change. If the screen
shows a number, declare whether the truthfulness of the data was checked.

**The preferred medium is an Artifact page** (a private page on claude.ai, which you publish and the owner
opens through the link), when the session has the tool: before × proposal × reference side by side, in
light and dark, at the screen widths the project declares (with no declaration, those the product
demonstrably serves, stated on the page: the laptop one, and the phone one only if it runs on a phone —
a width it does not serve produces a false finding), so the owner can see, comment and ask for adjustment before
you touch the product. The rite is that of the
image: publish, wait for the link to confirm and only in the next turn make the 3 options. Without the
tool, the usual image. The page leaves the owner's computer: fictitious data only. If the screen has
customer data or credentials, swap in fictitious data before publishing, or stay with the local image.

**A manual action by the owner is a click-by-click walkthrough.** When the delivery requires them to work in a
console, panel, spreadsheet or browser: number the steps, say **what they will see on each screen**
(not only what to do), give the exact text of buttons and fields, say the expected result of each step
so they can check before moving on, and warn when an authorization screen is going to appear. Never
assume they know where something is. This is different from the decision format above, and both apply together.

## 8. What a "done" must have

- **Fresh evidence from the current round, pasted in the answer.** Memory is not evidence.
- **What did not run, declared as not run.** Silence about a test is the same as lying that it
  passed.
- **Each request tied to the check that proves it, with its state:** proven (with the output), failed or
  not tested. Without evidence the item is "not tested", never delivered; a command that failed, timed out or
  did not run verified nothing.
- **A flaky test is fixed or removed, never rerun until it passes.** Rerunning until it comes out
  green is not proof.
- Files changed, listed.
- Remaining risks and what needs a human.
- If a sub-item stayed pending, the stage is **open** — not "complete with a caveat".

Never report success without having looked at the output. If the test failed, say it failed, with the output.

**Conclusion first, detail after.** Coverage is not clarity: when table, measurement and caveat
all come out at once, the main point ends up the same size as the secondary one and the owner has to
dig. Open with the direct answer in one or two sentences; the evidence is there for them to **check**,
not for them to discover the answer. This does **not** loosen the requirement of pasted evidence — it changes the
size of the prose around it, not the proof. The lean form of this — conclusion on the first
line and the output block reduced to the line that proves it — is in the response-quality block that the session
opening injects (rules 1 and 5).

**A subagent report is a claim, not a fact.** And own measurement beats a lens opinion, even
an expensive opinion, even one marked P0 — see the meter rule in
[04-verificacao.md](references/04-verificacao.md).

## 9. References

| File | When to read |
|---|---|
| [01-marchas-e-gates.md](references/01-marchas-e-gates.md) | when classifying the task and assembling the gates |
| [02-rubrica-aaa.md](references/02-rubrica-aaa.md) | when inspecting anything visible to the user |
| [03-inspecao-cega.md](references/03-inspecao-cega.md) | when assembling the inspector loop |
| [04-verificacao.md](references/04-verificacao.md) | when running a test, measuring anything, or proving a done |
| [05-governanca.md](references/05-governanca.md) | when recording a decision, writing docs, doing a handoff or release |
| [06-ambiente.md](references/06-ambiente.md) | when writing a script, hook, or touching the git index |
