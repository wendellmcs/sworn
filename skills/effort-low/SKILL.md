---
name: effort-low
description: Lowers the reasoning effort of the main conversation to low until the end of the turn. Use at the start of each turn of a task the playbook's Step 0 classified as Fast gear (typo, text, rename, one-off config). Changes only the effort, never the model.
effort: low
user-invocable: false
---
# `sworn:effort-low` — Fast gear, low effort

Claude Code applied `effort: low` from this skill's frontmatter (Claude Code docs, skills, field `effort`): the main
conversation runs at low effort until the end of the turn that called this skill. The next turn, even in the same
chat, is back at the session effort (measured by sworn on Claude Code 2.1.311), so the playbook calls this skill again
at the start of each turn of a Fast task (playbook, §2). There is nothing to run. Low effort is not a lower gate:
"Fast" never means improvised, and the gear's gate still decides what is verified (playbook, §2).

## The model does not change

A skill that the model calls changes **only the effort**. Measured by sworn on Claude Code 2.1.310: called through the
Skill tool, a skill with `effort: low` took the main conversation from `sonnet/medium` to `sonnet/low` (probe run12);
the model only changed when the user typed the skill (probe run15). sworn cannot switch the main conversation's model
on its own.

**Once per conversation**, the first time a level skill runs, tell the owner in one line, in the owner's language, and
go on with the work. After the context is compacted, if you can no longer see that you told them, tell them again.
In English:

> sworn: this is a quick task, so I am thinking with less effort (low): faster answers, with the same checks. The
> model stays the same: a skill cannot switch it (sworn measured this on Claude Code 2.1.310). Nothing for you to do;
> if you want another model, type `/model`.
