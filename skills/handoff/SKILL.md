---
name: handoff
description: Generates the continuation text for a new chat, with everything the next one needs to continue exactly where this one stopped. Use when a countable context-health trigger fires, when closing a stage of a long plan, or when the user asks.
argument-hint: "[short name of the work]"
---

# `/sworn:handoff` — the bridge between chats

Drift starts when the plan begins to be executed from memory. **Handoff is a bridge between chats, not a
substitute for the plan.**

**New chat that started from a summary** (`handoff/AAAA-MM-DD-retomar-<id>.md`, written by the notice for returning to a
stopped chat): the summary is a mechanical snapshot of the old chat's log, not this handoff. Read it, check on disk what
it says (step 1) and, if the work calls for a full bridge, write the handoff here, in the new chat — never in the stopped chat,
which would rewrite the entire conversation.

## Step 1 — check the facts on disk, not from memory

**Background agents first.** The handoff only comes out with every background agent of this session finished: a
handoff written while one still works goes stale when it reports, and the next chat opens beside a conversation that
is still running. Run:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/agentes-rodando.js"

If it lists an agent, stop here: tell the user it is time to open a new chat and that the handoff comes when the last
agent finishes; do not stop any of them and do not launch new ones. Each completion notice arrives on its own; when the
last one has arrived, run this skill again. An agent counts as running while its `subagents/agent-<id>.meta.json` lacks
`"finished": true`, unless it was stopped or has written nothing for 30 minutes.

Then run, and paste the output:

    git -C . rev-parse HEAD
    git -C . rev-parse --abbrev-ref HEAD
    git -C . status --short
    node "${CLAUDE_PLUGIN_ROOT}/scripts/uso.js"

**A number that goes into the handoff is read from disk.** Never from the previous handoff, and never from memory.

## Step 2 — write the file

In `.claude/sworn/handoff/AAAA-MM-DD-<slug>.md`, with **all** of these sections:

1. **Reading order** — absolute path of the plan, the ledger and the previous handoff, in order.
2. **Topology** — each repository involved, with branch and **HEAD SHA**, pasted from step 1.
3. **Where we are** — at which stage of the plan, and which is next, **with the stage's text checked in the
   file**, not paraphrased. With a study in progress, the path of each sheet: the radar one
   (`.claude/sworn/radar/<AAAA-MM-DD>.md`) and the reference one (`.claude/sworn/referencias/`), and whether it
   has already entered `referencias` or is waiting for the owner's yes — otherwise the new chat studies everything again.
4. **Human decisions already made** — in the form "do not ask again", with the date.
5. **Pending items and blockers that are NOT findings of this session** — a pre-existing failure is this, and without
   this section the next chat will "discover" it and lose time. **A pending item is not dragged from handoff
   to handoff**: a list that only grows has no owner. Before the prompt, take each new pending item to the owner,
   all of them at once and in 3 options, and write here only what was already decided or what has an owner and place declared.
   **The owner's requests:** read `.claude/sworn/pedidos/<front>.md` (`sem-frente.md` with no front), the numbered
   list the hook writes with every message of theirs, and bring each request with its number and state: done (with
   the evidence), open, or refused (with the decision). An open request is a pending item of this section.
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

## Step 3 — offer the switch, in the same response

Generating the file is not enough. In the **same response**:

1. say in so many words that it is time to open a new chat, **citing which trigger fired**;
2. **paste the ready prompt in the chat, in a code block** — the user must be able to copy without opening anything;
3. **do not ask "shall I continue?" before offering the switch.** The switch comes first; if they prefer to
   continue, they say so.
