---
name: learn
description: Turns a user correction into a proposed rule in the trigger -> action format, shows it ready, and only writes it after explicit approval. Use when the user corrects your behavior and the correction should hold for future sessions.
argument-hint: "[the correction, in one sentence]"
---

# `/sworn:learn` — proposal, never automatic writing

The plugin **does not learn on its own.** Nobody on the market has that, and promising it is a promise that is not
kept. What it does is turn a correction into a proposal, and wait for the OK.

The reason for the gate, said plainly: **I often misread a correction.** A misunderstood correction written without approval
becomes permanent law that guides me every day — and the agent itself would end up writing the file that governs it.

**When this skill is offered unasked.** The `abrir-turno.js` hook (a script that Claude Code
runs by itself on every user message) warns the agent when the message looks like a correction of
its behavior. The agent answers the request first and, in the same response, runs this skill and asks
in 3 options (Step 4): write as is, adjust the text first, or do not write. The hook never writes:
writing still requires the user's yes. At most one offer every 5 turns; turn it off with
`"sugerirAprender": false` in `.claude/sworn/projeto.json`. If the message was a bug report or an
answer to a question, ignore the offer: go on without running the skill, and nothing is written.

## Step 1 — separate what was corrected from what I understood

Write both things, side by side, for the user to check:

- **What you said:** <their sentence, verbatim>
- **What I understood:** <your reading, in one sentence>

If the two do not match, they correct it now and not a month from now.

## Step 2 — turn it into `gatilho → ação`

A loose prohibition decays with long context; a trigger is summoned by the action itself.

| Bad | Good |
|---|---|
| "do not do unrequested hardening" | "on finding a security problem outside the scope → record and warn, never fix" |
| "careful with Windows" | "when writing a shell command → use the shell declared in `projeto.json`" |

No volatile fact: version, flag, price, model name, event name. The validator refuses. If it
refuses, the output gives the reason and nothing was written: take the volatile datum out of the text (point to where it
lives, for example the `projeto.json` field) and propose again.

## Step 3 — propose, without writing

    node "${CLAUDE_PLUGIN_ROOT}/scripts/propor-regra.js" --gatilho '<quando>' --acao '<o que fazer>'

The rule text goes between **single quotes**, in both shells: with double quotes, a backtick or a
`$(...)` inside it runs as a command and the rule comes out mutilated (and is written that way). Inside the
text, each case has its own care:

- **Apostrophe** (`'`): write `'\''` in bash and `''` in PowerShell.
- **Straight double quotes** (`"`), in Windows PowerShell 5.1: do not use. They vanish on the way to `node`
  (measured; backtick, `$` and apostrophe arrive intact). Replace them with typographic quotes “ ” or rewrite
  without them.
- **Typographic apostrophes** (‘ ’), in PowerShell: they **close** the single-quoted string and the
  command does not even run. Replace each with a doubled `'` (`''`) or rewrite without them.
- **Trailing backslash** (`\`), in Windows PowerShell 5.1: a text with a space that ends this way
  swallows the next argument (measured). Do not end the text with it.
- **Line break:** do not put one. The rule is **a single line** (`gatilho -> ação`). The script refuses
  a trigger or action with a line break before anything else: it answers `RECUSADA` and writes nothing. Write the
  trigger and the action in one sentence each, with no Enter in the middle.

Check in the `propor-regra.js` output that the text came out the same as you intended before moving on to
Step 4. `${CLAUDE_PLUGIN_ROOT}` arrives already replaced by the real path and stays in double quotes
because that path may have a space.

Paste the output. It says, in so many words, that it **wrote nothing**.

## Step 4 — ask for the decision, in 3 options

Use `AskUserQuestion`, with the recommended one first and marked:

- **Write as is** — becomes a rule of this project and comes back in every session from now on.
- **Adjust the text first** — you rewrite and propose again; nothing is written in this round.
- **Do not write** — holds only for this conversation, and disappears when it closes.

## Step 5 — write, only after the OK

    node "${CLAUDE_PLUGIN_ROOT}/scripts/propor-regra.js" --gatilho '…' --acao '…' --gravar

Paste the output, which carries the total number of rules. If the total did not go up by 1, the
line was not read as a rule: open `.claude/sworn/regras.md` and check the text. **If the number of rules goes over ~40, warn the user:**
a large rules file dilutes attention and speeds up exactly the disease it came to cure.
