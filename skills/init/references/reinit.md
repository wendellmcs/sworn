# Re-init — the rules of a reconfiguration

Read from Step 0b of [`SKILL.md`](../SKILL.md), **only when `.claude/sworn/projeto.json` already exists** under
the absolute root of Step 0. Every step this file names (Step 5, Step 5b, Step 6, Step 7, Step 7e...) is a step of
that `SKILL.md`. Follow these rules for the whole init, up to Step 8.

**If the current `projeto.json` is empty, is not valid JSON, or is JSON but not an object** (`null`, a list, a
string or a number), there is nothing to compare or preserve: say so,
show its content, and ask the owner whether to go on as a first init (the file is overwritten) or stop so they fix
it by hand.

**Three rules that apply only in a re-init:**

- **Ask the owner only what makes sense to ask again.** What the owner does not answer again **stays as it is**,
  and an empty answer is not an answer: the field keeps its value unless the owner says to clear it. Do not reread
  the whole list of Step 4 questions: that is asking the owner to redo the work.
- **Show what changed before writing.** No script compares them: you do. Before the `Write`, put the current
  `projeto.json` side by side with what will be written, and show **two lists**: the fields whose value changed
  and the answers that **did not fit in any field** (the answer's name is not a key of `projeto.json`). An answer
  silently discarded is the failure this plugin exists to stop. **Preserve what the interview did not ask again:**
  - keys set by hand that `projeto.json` already has, the `limiares`, the `travas` and the `marchas`;
  - under `agentes`, init only writes `agentes.escada` (the agents from cheapest to most expensive) and
    `agentes.degraus` (the name, model alias and effort of each rung); other sub-keys set by hand survive;
  - a partial answer is merged by key, it does not replace the whole object;
  - any other field left unanswered.
- **The `regras.md` of Step 6 is not overwritten.** It may have been edited by hand since.
  If it already exists, say so and move on.

**Before any `Write` in `.claude/sworn/` (the `projeto.json` of Step 7, the `design.json` of
5b if you are going to write it, the `regras.md` of Step 6 if it no longer exists), declare the scope.** Three
terms, in plain words: the **scope gate** ("trava 4" in the gate's message) is the protection that only lets a file be written
if the declared scope of the task covers it; the **scope** is the file `.claude/sworn/escopo.md`,
the list of what this task may edit; and the **gear** is the level of rigor that `projeto.json` gives to
each path (`padrao` requires a declared scope, `rapida` does not; Step 5 details it). In a re-init the
`projeto.json` is already on disk, so the gate is up — and in `padrao` gear, with no scope, it
**denies** those `Write`s (the same trap Step 7e describes for the catalog).
**Tell the owner, in plain words, that you are going to create or extend `.claude/sworn/escopo.md` only so you can
write the configuration, which lines you are adding, and that you will take back whatever you add to a scope that
already belonged to another task.**

First put `.claude/sworn/projeto.json` and `.claude/sworn/regras.md` in the "Dentro" section of the scope
— and `.claude/sworn/design.json` **only if 5b is going to write it** (5b is optional) — because the gear map
Step 5 recommends (`rapida`: `**/*.md`, `docs/**`) does **not** cover `.json`, and the map
may not even exist. The gate always lets `escopo.md` and the front file (below) through, without requiring a
scope: you can edit them before any other `Write`. If
`.claude/sworn/escopo.md` already exists (it belongs to another task in use), **add** those lines to its
"Dentro" section with `Edit`, without deleting the rest; **a line that is already there is not added, and it is
not yours to remove**. Only create the file if it does not exist — and, if init
created it, it is just scaffolding so the configuration can be written: **Step 8 removes it** (a leftover
scope file starts restricting the `padrao` gear after init). If it exists but
has no "Dentro" section, create the section. If the session is bound to a front (the own scope of a
parallel line of work, in `.claude/sworn/escopos/<frente>.md`; see "With more than one front" in Step 8 of
`SKILL.md`), that is the file you add to.

**In Step 8, before closing, remove again the lines you added** (with `Edit`, only the ones you added; the file
belongs to another task, and leaving them there widens its scope forever). **An init interrupted before
Step 8** (the owner gave up, the session closed, you stopped without `OK` in Step 7) leaves those lines in the
other task's scope. So: if you yourself are going to stop before Step 8, remove them before stopping; and **when
resuming an interrupted init**, the first step is to open the scope in force and remove (with `Edit`, only them)
the lines that init added — `.claude/sworn/projeto.json`, `.claude/sworn/regras.md` and, if it applies,
`.claude/sworn/design.json` in the "Dentro" section. The new session cannot know which of them were already there,
or whether init created the file: **if you did not see the addition yourself, ask the owner before removing a
line or the file.** With the owner's confirmation that init created `escopo.md`, remove the whole **file** if it
only has init's lines; if it has more than that, remove only init's lines.

The gate only sees the `Write` and `Edit` that **you** do. The generators of Steps 7b, 7c and 7d write
by script (`--gravar`), outside it, so this scope does not need to cover `.claude/agents/`, the project's skill
or `AGENTS.md`.

After writing, **run the Step 7 validator the same way** and paste the output. A re-init that fails is a
configuration that protects less than it appears to, exactly as in the first init: **fix what the validator points
to and run it again; do not go on to Step 8 while it fails.**
