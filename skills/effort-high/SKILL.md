---
name: effort-high
description: Raises the reasoning effort of the main conversation to high until the end of the turn. Use at the start of each turn of a task the playbook's Step 0 classified as AAA gear (user-visible UI, release, security, broad refactor, long plan). Changes only the effort, never the model.
effort: high
user-invocable: false
---
# `sworn:effort-high` — AAA gear, high effort

Claude Code applied `effort: high` from this skill's frontmatter (Claude Code docs, skills, field `effort`): the main
conversation runs at high effort until the end of the turn that called this skill. The next turn, even in the same
chat, is back at the session effort (measured by sworn on Claude Code 2.1.311), so the playbook calls this skill again
at the start of each turn of an AAA task (playbook, §2). There is nothing to run. Effort is how hard the model
thinks, not what it verifies: the AAA gates still decide that (playbook, §2 and §4).

## The model does not change

A skill that the model calls changes **only the effort**. Measured by sworn on Claude Code 2.1.310: called through the
Skill tool, a skill with `effort: low` took the main conversation from `sonnet/medium` to `sonnet/low` (probe run12);
the model only changed when the user typed the skill (probe run15). sworn cannot switch the main conversation's model
on its own.

**Once per conversation**, the first time a level skill runs, tell the owner in one line, in the owner's language, and
go on with the work. After the context is compacted, if you can no longer see that you told them, tell them again.
In English:

> sworn: this task needs the most care, so I am thinking with more effort (high): slower answers, more thorough.
> The model stays the same: a skill cannot switch it (sworn measured this on Claude Code 2.1.310). Nothing for you
> to do; if you want another model, type `/model`.
