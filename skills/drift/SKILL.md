---
name: drift
description: Shows where the code moved away from the plan - a script crosses the files changed since the plan's commit with the plan's paths and boxes - a changed file the plan does not cite, a box marked done whose file did not change, and a file a done box said to create that does not exist. Use before closing a stage of a plan, or when the owner asks whether the work followed the plan.
---

# `/sworn:drift` — the code against the plan

Original failure: the plan says one thing, the diff does another, and nobody notices until review. Rereading the
whole code against the plan by eye is slow and misses things in silence. Here a script reads the diff since the
plan's base and crosses it with the paths and boxes the plan cites.

## Step 1 — the report

    node "${CLAUDE_PLUGIN_ROOT}/scripts/drift.js" "<plano.md>" [--desde <commit>]

Keep the quotes: a plan path with a space stays one argument. Paste the output. Exit code 0 is `nenhum achado`, 1 has
findings (Step 2), 2 did not compare: the message says why (the plan was not read, the folder is not a repository,
the base is not a commit, or git failed) and what to do. The base is the commit that created the plan; a plan
outside git (an ignored folder) needs `--desde <commit>`, and without it the script stops with code 2 and says so. The changed files are the diff from the base to the working tree plus the files git does not
track yet. The plan itself and what sworn and the harness write (`.claude/`, `.sworn/`, `.context/`) are not drift.

## Step 2 — each finding

| Finding | What it means | What you do |
|---|---|---|
| `fora-do-plano` | a file changed and the plan does not cite it | if the change belongs to the task, add the file to the plan with the reason; if not, undo it. A change that widens the task's scope is the owner's call |
| `feita-sem-mudanca` | a box is marked done and the file on its line did not change since the base | reopen the box, or write on its line why the step needed no change |
| `criar-ausente` | a done box said to create a file that does not exist | create it, or reopen the box |

A short name in the plan (`saude.js`) covers the file of the repository that ends with it.

## What this skill does not do

- It does not judge whether the change is right: it only says where the code and the plan disagree.
- It does not read inside the files: a file that changed counts as covered when the plan cites it.
- It does not check the plan before coding: that is `/sworn:review-plan`.
