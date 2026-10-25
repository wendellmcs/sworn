---
name: calibrate
description: Measures, in the project's own conversations, from how many context tokens switching chats still pays off, and suggests the switch threshold. Only writes to projeto.json with the owner's explicit yes. Use when the owner asks whether the chat-switch threshold fits this project, or after a few weeks of use.
---

# `/sworn:calibrate` — the switch threshold measured in your project

The chat-switch warning by size goes off at 175 thousand tokens (the default). That number was measured in the conversations of
a single project (the plugin author's sessions). This skill measures **yours**: it reads the transcripts that Claude Code keeps
for this project, calculates what each context band costs, what a switch costs here, and simulates the
switch at the end of the owner's turn for each threshold from 150 thousand up to below the alarm.

**Only numbers leave the script.** It reads the text of the conversations to count, but no excerpt goes to the
output. Even so, do not paste the output outside this conversation unless the owner asks.

## Step 1 — measure

    node "${CLAUDE_PLUGIN_ROOT}/scripts/calibrar.js"

Run from the project folder. The script looks for the transcripts in `projects/` of the Claude Code
config folder. If it does not find them, it exits with `erro` and asks for the path: the folder is the one that has this project's `.jsonl`
files, inside `~/.claude/projects/` (or `projects/` in `CLAUDE_CONFIG_DIR`, if
it is set), with the project's path in the name; tell the owner this, ask which it is and run
again with `--pasta "<path>"`. If `erro` comes again, or an output that is not JSON, show it to the
owner, say that calibration does not run without this project's transcripts and that they can check the path
and call `/sworn:calibrate` again; and stop. Do not read or open the `.jsonl` files yourself: they can be many megabytes.

## Step 2 — present, in this order

1. **The sample:** how many sessions, from what date to what date, and how much they cost in total.
2. **The suggestion** (`sugestao`): the threshold and the reason. If `suficiente` comes back `false`, say in
   so many words that the sample is small and that the current threshold stays; show the reason the script gave, do not
   propose writing anything and say it is worth running again after a few more weeks of use.
3. **Why that number:** the `simulacao` row for the suggested threshold and the two neighbors.
   A negative `pctDoCusto` is savings against never switching; positive, extra spend. The suggestion's
   rule is the lowest threshold at which switching does not cost more than not switching.
4. **What a switch costs here** (`troca`): if `medida` comes back `false`, the cost is the plugin's default,
   measured by the author (the project does not yet have enough switches to measure its own) — say so.
5. **Where the work stops** (`paradas`), only if the owner wants: the agent's last message before each
   owner reply, by type. It is the number that continuous mode wants to lower.

## Step 3 — write only with the owner's yes

`limiarAtual` is what holds today, and `limiarAtualDe` says where it comes from: `projeto.json` (written),
`modo continuo` (the 250 thousand warning of continuous mode switched on) or `padrao do plugin`; say the origin along with the
number. If the suggestion equals `limiarAtual`, say that the current threshold is already the measured one and that there is nothing to
write. If it differs and the sample is sufficient, take the decision to the owner in three options, the
recommended first: write the suggestion; keep the current threshold; another number they choose. Only after
the explicit yes, write **through the command**, passing only the integer ("200 thousand" becomes `200000`):

    node "${CLAUDE_PLUGIN_ROOT}/scripts/calibrar.js" --gravar <tokens>

"Keep" is also written, with `--manter` in place of `--gravar <tokens>`: the command writes the threshold in
force (the output carries `manteve: true`). Without it, the project stays "never calibrated" and the calibrate button
comes back in every chat.

The command accepts from 50000 up to below the alarm, touches only `limiares.tokensDeContexto` and preserves the
rest of `projeto.json`. Say it wrote only when the output carries `gravou: true`. If the command
refuses the number, show the `erro` to the owner (it states the accepted range) and ask for another number once; refused
again, state the range, say the current threshold stays, and stop. If the command fails for
another reason (no `projeto.json`, invalid JSON) or the output is not JSON, show the `erro` and what it
says to fix, and stop. **Never through `Write`:** the scope gate (lock 4) denies writing to `.claude/sworn/projeto.json` without a declared scope, and editing JSON by hand is the
fragile way.

## What this measurement does NOT do

- **Does not measure quality.** It counts money. A long conversation can drift from the plan without costing more.
- **Does not see subagents.** Only the main conversation enters the count.
- **Does not know a model outside the price table.** Calls to those models are left out and appear
  in `chamadasSemPreco`.
