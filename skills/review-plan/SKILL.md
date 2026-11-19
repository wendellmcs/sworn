---
name: review-plan
description: Checks a written plan before the first edit - a script confirms that every path, symbol and command the plan cites exists and that each open step carries a proof command, then the blind review reads the plan with the script's report beside it. Use whenever you are asked to follow, implement or execute a plan (a plano.md, a PLAN.md, or a plan in the request), before the first edit, and after writing a plan, before coding from it.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/revisar-plano.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/revisar-plano.js" *)
---

# `/sworn:review-plan` — the plan checked before the code

Original failure: the plan cites a file that is not there, a function under another name, a command with no script,
a step with no way to prove it — and the code starts on top of it. Asking the model to "check every one" fails in
silence: a skipped check looks the same as a clean one. Here the existence check is a script, and it counts what it
checked.

## Step 1 — the mechanical check

    node "${CLAUDE_PLUGIN_ROOT}/scripts/revisar-plano.js" "<plano.md>"

Keep the quotes: a plan path with a space stays one argument. Paste the output. Exit code 2 means the plan was not
read (the message says why): fix the path, from the current folder, and run again. A report with `0 citados` means the
plan cites nothing between backticks, so nothing was checked: tell the owner that, it is not a clean plan, and stop
here. Step 2 only runs once the plan cites what it touches.

The script reads what the plan cites between backticks and checks it on disk, from the current folder:

| Finding | What it means | What you do in the plan |
|---|---|---|
| `caminho-inexistente` | the path does not exist and its line does not say it will be created | fix the path, or say on the line that the file is new ("criar", "novo") |
| `simbolo-ausente` | the symbol right after a path (`` `a.js` -> `nome` ``) is not in that file | fix the name, or the path |
| `comando-sem-script` | `node <script>` with no such script, or `npm run <x>` with no such script in `package.json` | fix the command |
| `caixa-sem-prova` | an open box (`- [ ]`) with no proof command on its line or its continuation | add the command that proves the step |
| `plano-sem-requisitos` | the plan has boxes and no numbered requirement | write each requirement on a line of its own, `R<n>: <what must hold>`, and cite it in the boxes |
| `requisito-duplicado` | a second line defines an `R<n>` already defined (leading zeros do not count: `R<n>` with zeros in front is the same number) | give it another number, or merge the two |
| `requisito-sem-passo` | a requirement `R<n>` no box cites | cite it in the box that meets it, or take it out of the plan |
| `passo-sem-requisito` | an open box that cites no `R<n>` | put on its line the requirement the step meets |
| `requisito-inexistente` | a box cites an `R<n>` the plan does not define | define it, or fix the number |

**Requirements are mandatory in a plan with boxes.** A requirement is a line that starts with `R<n>:` (or `R<n>.`,
`R<n> -`), with an optional list marker, heading or bold: `- **R<n>:** the session expires after 30 minutes`. A box
cites it by writing its `R<n>` on its line or its continuation. The requirements say what must hold; the boxes say how,
and every box answers to one. An old plan without them fails here until it gets them.

A short name (`saude.js`) counts when some file of the repository ends with it; a plan next to the plan is found by
name. Code blocks are left out. Fix each finding in the plan and run again, until it says `nenhum achado`. A finding
kept on purpose stays only with the reason written on its line.

## Step 2 — the blind review of the plan

Run `/sworn:review <plano.md>`: the plan is text, and the band comes from the script, as for any file. Add this line
to each inspector's briefing, with the numbers the Step 1 report prints (`citados`, `conferidos`, `achado(s)`):

> A script already checked existence: <citados> cited, <conferidos> checked, no findings. Do not report a cited
> path, symbol or command as missing. Judge whether each step can be proven, whether the order holds, whether
> any step leaves a decision to whoever codes it, and whether the steps that cite each requirement `R<n>` are enough
> to meet it.

With findings kept on purpose, write instead of "no findings": "<n> findings kept on purpose, each with its reason
on its line".

## Step 3 — another model (optional, only if the owner asks)

A second opinion from another model goes through the bridges in `docs/harnesses.md`: the same plan file and the same
Step 2 briefing. Its findings are claims, like any inspector's; the script's count stays the evidence.

## What this skill does not do

- It does not run the commands the plan cites: it only checks that their script exists.
- It does not judge whether the plan is good: Step 2 does, blind.
- It does not check the code against the plan after coding: that is `/sworn:drift`.
