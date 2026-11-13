---
name: handoff
description: Generates the continuation text (the handoff), with everything the work needs to continue exactly where it stopped, in this conversation after it is compacted or in a new chat. Use when a countable context-health trigger fires, when closing a stage of a long plan, or when the user asks.
argument-hint: "[short name of the work]"
---

# `/sworn:handoff` — the bridge over compaction

Drift starts when the plan begins to be executed from memory. **Handoff is a bridge over the compaction of the
conversation (and between chats), not a substitute for the plan.** The work goes on in the same conversation: when the
harness compacts it, sworn has the handoff reread; nobody opens a new chat or pastes the prompt.

**New chat that started from a summary** (`handoff/AAAA-MM-DD-retomar-<id>.md`, written by the notice for returning to a
stopped chat): the summary is a mechanical snapshot of the old chat's log, not this handoff. Read it, check on disk what
it says (step 1) and, if the work calls for a full bridge, write the handoff here, in the new chat — never in the stopped chat,
which would rewrite the entire conversation.

## Step 1 — check the facts on disk, not from memory

**Background agents first.** The handoff only comes out with every background agent of this session finished: a
handoff written while one still works goes stale when it reports, and the next chat opens beside a conversation that
is still running. Run:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/agentes-rodando.js"

If it lists an agent, stop this skill here: tell the user in one line that the handoff comes when the last listed
agent finishes, that the work goes on in this conversation and that nothing is needed from them;
do not stop any of them and do not launch new ones, and go on with the work that does not depend on them.
Each agent's completion notice arrives in this chat on its own; when the last listed agent's notice arrives, run
this skill again. The script counts an agent as running until its record says it finished, unless it was
stopped or has written nothing for 30 minutes.

Then run, and paste the output:

    git -C . rev-parse HEAD
    git -C . rev-parse --abbrev-ref HEAD
    git -C . status --short
    node "${CLAUDE_PLUGIN_ROOT}/scripts/uso.js"

**A number that goes into the handoff is read from disk.** Never from the previous handoff, and never from memory.

## Step 2 — write the file

In `.sworn/handoff/AAAA-MM-DD-<slug>.md` (outside `.claude/`, a folder where Claude Code stops to ask permission
for the write, or refuses it when nobody is there to answer). **A script drafts it**; you fill in only what takes
judgment. The script copies what is on disk when it runs, so **first** bring the pending file and the owner's
requests up to date (section 5 below has the commands: `pendencias.js --adicionar`/`--fechar` and
`pedidos.js --marcar`). Then, from the project root:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/handoff-curto.js" --slug <slug>

`<slug>` is the theme: lowercase ASCII letters, digits and `-`, starting with a letter or digit, up to 60 characters,
and never containing `retomar` (that word names the summary of a stopped chat). The script only prints, it writes
nothing. The output says `arquivo: <path>` and brings the text: the reading order, the topology and `git status`, the
plan's next unticked item copied from the file, the open pending items and requests, and the prompt. Replace each `<<...>>`
mark with what it asks, keep the rest as it came, and write the file with **Write** at that path: the hooks only
recognize this session's handoff by a Write or an Edit. Then check it:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/handoff-curto.js" --conferir <path>

With `"ok": false` (exit 1), fix what `problemas` points to (a mark left, a missing section, the prompt out of place,
the file above the 4 KB cap) with Edit and run it again; exit 2 means the file was not read at that path, not that the check failed: take the path from the `arquivo:` line,
run from the project root and run `--conferir` again. If the script does not run, write the file by hand with the same sections.
The sections, in this order:

1. **Reading order** — absolute path of the plan, the ledger and the previous handoff, in order.
2. **Topology** — each repository involved, with branch and **HEAD SHA**, pasted from step 1.
3. **Where we are** — at which stage of the plan, and which is next, **with the stage's text checked in the
   file**, not paraphrased. With a study in progress, the path of each sheet: the radar one
   (`.claude/sworn/radar/<AAAA-MM-DD>.md`) and the reference one (`.claude/sworn/referencias/`), and whether it
   has already entered `referencias` or is waiting for the owner's yes — otherwise the new chat studies everything again.
4. **Human decisions already made** — in the form "do not ask again", with the date. Then the **autonomous decisions**
   of this session: each `Decisao:` line your answers wrote (what, why, cost if wrong), so the next chat neither redoes
   nor reverses them without seeing why.
5. **Pending items and blockers that are NOT findings of this session** — a pre-existing failure is this, and without
   this section the next chat will "discover" it and lose time. **A pending item is not dragged from handoff
   to handoff**: a list that only grows has no owner. Before the prompt, take each new pending item to the owner,
   all of them at once and in 3 options, and write here only what was already decided or what has an owner and place declared.
   **The pending list lives in one file**, `.sworn/PENDENCIAS.md`, numbered, each item with its owner and date; the
   handoff brings its open items from there instead of copying them from the previous handoff. Before running the
   script above, add each pending item that has an owner, and close the ones this session settled (`--listar` shows
   the numbers, in JSON):

       node "${CLAUDE_PLUGIN_ROOT}/scripts/pendencias.js" --listar
       node "${CLAUDE_PLUGIN_ROOT}/scripts/pendencias.js" --adicionar --dono <who> --texto "<what is missing>"
       node "${CLAUDE_PLUGIN_ROOT}/scripts/pendencias.js" --fechar <n> --como "<commit, decision or why no action>"

   **The owner's requests:** the hook writes every message of theirs, numbered, in `.claude/sworn/pedidos/<front>.md`
   (`sem-frente.md` with no front; a long one is kept whole in `pedidos/<front>/<n>.md`, and a pasted handoff prompt is
   a marked line without a number, not a request). With no front, leave out `--frente` in both commands below. List
   the open ones (no state mark yet):

       node "${CLAUDE_PLUGIN_ROOT}/scripts/pedidos.js" --abertos --frente <front>

   Mark each one this session settled, with its evidence, so it stops being open:

       node "${CLAUDE_PLUGIN_ROOT}/scripts/pedidos.js" --marcar <numbers> <feito|recusado|respondido> "<commit, D### or what was answered>" --frente <front>

   `<numbers>` is `3`, `1-4` or `1-4,7`. `feito` carries the commit; `recusado`, the owner's decision that declined
   it; `respondido`, a question that asked for no change, with what was answered. Bring each request
   still open with its number: an open request is a pending item of this section, and a request that asks for a
   change in the plugin becomes a plan item (it ships in a version).
6. **Method errors that cost time** — so they are not repeated.
7. **Third-party files left untouched** — from the `git status` of step 1.
8. **Ready-to-paste prompt**, in a code block.

**Never include a secret, credential or customer data.**

If the session works on a plan, let the plan panel (`/sworn-plan`) find it in the new chat:

- at the end of the **Objetivo** of the scope in force (the front's file in `.claude/sworn/escopos/`, or
  `.claude/sworn/escopo.md` with no front), the line `Plano: <path of the plan>`, with the path in
  backticks if it has a space. New plan: replace the old `Plano:`, do not add another;
- on each box this session ticks in the plan, its mark: `- [x] step (sN: what was done)`. A box
  ticked by an earlier session does not get this session's N. The sessions spent and the panel's estimate come from these
  marks. **The session's N:** if it has already written its note `(sessao N, ...)` in the Objetivo, it is that note's N. If
  it has not yet, read the disk: the highest number already used among the notes in the Objetivo of the scope in force and the
  marks `(sN` of the plan, plus 1 (1 if there is none); write the note with it before ticking boxes or table
  rows. The note and all the session's marks, in a box or in a table row, carry that N.
  Two sessions open at the same time may arrive at the same N: when writing the note, if the N is already in another session's
  note, use the next one. The panel counts the distinct Ns: a skipped number does not change the count, and a
  session that left no mark does not enter it;
- plan with the stages in a table (1st column `Etapa`, `Fase`, `Item`...): on the stage the session closed,
  `[FEITO]` in the 1st cell, after the id copied from the table (`| **P2 motor** [FEITO] | ...`), and the
  session's mark `(sN: what was done)` in the last cell of the same row. With no mark at all in the table, the panel
  deduces from the `ETAPA <id>` in the Objetivo (the earlier ones done, that one in progress) and warns that it deduced; the 1st
  `[FEITO]` mark ends the deduction, so, when placing the first, also place `[FEITO]` on every earlier stage already
  done, or the panel starts to treat them as not done. On those earlier ones, when the Objetivo's notes
  say which session closed them, also place its mark, with its N (`(s3: what was done)`); with no
  mark, the stage counts as done, but the session that closed it stays out of the sessions spent.

## Step 3 — paste the prompt and keep working, in the same response

Generating the file is not enough. In the **same response**:

1. **paste the ready prompt in the chat, in a code block** — the user must be able to copy it without opening
   anything, if they ever want a new chat;
2. say in one line that the handoff is written, **citing which trigger fired** (or that the user asked), and that the
   work goes on in this conversation: when it is compacted, sworn has the handoff reread. Do not tell the user to open
   a new chat;
3. **go on with the next step of the work, if there is one; do not ask "shall I continue?".**

The one exception: a new version of sworn was installed in this session. It only loads in a new chat (`/clear` does
not reload the plugin), so then say it is time to open a new chat and point at the prompt above.
