# Governance, sources and handoff

---

## 1. Reading order, before changing anything

The concrete sources and the order among them belong to the project — `{{campo:fontesCanonicas}}`.
What is universal is the **form**:

1. The source the project declared canonical, in the order it declared it.
2. Product and design, when the task is UI, UX or visual critique.
3. Consolidated business rule.
4. Log of human decisions already taken.
5. Current code — which is the last link, not the first: code shows what is, not what should be.

Confirm facts with a repository search. **Inference must be marked as inference**, and a verified
statement must be marked as verified. A report in which the two look alike forces the reader to
recheck everything.

---

## 2. Human decision record

Once a decision is confirmed with `{{campo:quemDecide}}`, it goes to `{{texto:ondeRegistrar}}` with:

- the **date**;
- what was asked, in one sentence;
- the options presented and **which one was chosen**;
- the accepted consequence, when there is a cost;
- the "don't ask again" form.

**A decision that breaks a rule is recorded as a break**, not as a silent exception. A recorded break
is governance; a silent break is a debt nobody knows exists.

**If the same rule keeps being broken as routine, the defect is in the rule.** Two recorded breaks of
the same rule don't call for a third break: they call for a decision about recalibrating it.

**When recording in a numbered append-only document, read the last number from disk** — never from
the handoff. See the Step -1 section in [01-marchas-e-gates.md](01-marchas-e-gates.md).

**An announced decision is a recorded decision, in the same answer.** Saying "recorded" without having
written it is losing the decision: another front takes the number, and the next chat concludes that
nothing happened. The **ledger is a single file** — a fragment beside it, in another format, is
invisible to whoever resumes. When resuming, before believing "it didn't run", list the material
folder by date and look for the proof.

**Every time written to a file comes after the `date`, and in another turn.** Run `date` alone and
only in the next answer write the text with the time read. A time typed in the same command (or the
same Write) as the `date` is a guess, and a guess at the time errs forward. If the time must go into a
large text written earlier, leave a marker and swap it by script after the `date`.

**Mirror:** if the project keeps two copies of the same rule in different files, change both in the
same change set, and check which of the two is the source.

---

## 3. Change set — "touched X, must have touched Y"

The most expensive failure of any project with more than one artifact is **asymmetric publishing**:
one side of the pair goes up and the other doesn't, and the contract breaks in production.

Before closing, check the pairs the project declared. The most common forms:

| Form | Example |
|---|---|
| atomic pair across layers | touched the backend → must have touched the compatible client |
| document mirror | touched the source → must have touched the copy |
| new visible function | touched the feature → must have touched permissions, help, tests and docs |
| new recurring tool | touched the tool → must have documented where it lives |

**Before any irreversible action** (publish, promote, delete remote): save the previous version and
**record the rollback path in writing**. The gesture is what usually goes missing, not the intention.

---

## 4. Document hygiene

- Look for an existing doc **before** creating a new one. Link, don't duplicate. And say what was
  searched.
- A new doc declares: goal, status, source of truth, relation to the existing docs, and whether it is
  canonical / derived / adapter / historical.
- Completed plans, old audits and superseded specs go to an archive area.
- **Don't version junk:** log, HAR, screenshot, report, zip, cache, temporary, dump, credential,
  tool output.
- Obsolete, duplicated or misplaced file: **don't delete on your own.** Record it in
  `{{texto:ondeRegistrar}}`.
- When closing a documentation change, check that indexes and links are coherent.
- **A rule that points to what no longer exists is lying.** When moving or renaming, grep the
  references to the old path. A dead reference is worse than an absence: it gives false confidence.

---

## 5. Plans and handoff

**Local plan:** goal, out of scope, context read, probable files, steps, acceptance criteria,
recommended tests, risks and blocking questions.

**Handoff** in `{{texto:ondeHandoff}}`. Countable triggers and the obligation to offer the chat
switch are in `SKILL.md` §6. Mandatory content:

- absolute path of the plan, the ledger and the previous handoff, **in reading order**;
- topology of the repositories, branch and **HEAD SHA** of each;
- which stage of the plan we are in and which is next, with the stage text **checked in the file**;
- human decisions already taken ("don't ask again");
- pending items, blockers and pre-existing failures that are **not** a finding of this session;
- method errors that cost time, so they are not repeated;
- **ready-to-paste prompt, in a code block.**

Never include a secret, credential or customer data in the handoff.

**Hard rule of a long plan:** reread the plan's excerpt **in the file** before writing any brief.
Handoff is a bridge between chats, it doesn't replace the plan. A finding along the way is a temporary
deviation: record it, resolve it and **go back to the plan explicitly**, saying which stage you are
resuming. An addition to the plan is not a change of plan — don't rewrite or reorder because of it. A
deliberate deviation from the plan text requires a recorded human decision. **A stage is complete only
when all its subitems are done** — pending subitem = open stage.

---

## 6. Tools and dependencies

- Skill only when the task clearly matches the trigger.
- Adopted library or tool: with a **pinned** version, tag or commit. Without a reproducible
  reference, don't adopt.
- **Never `latest`**, nor an open range in a manifest, nor automatic upgrade, nor silent update.
- Update reviewed against a primary source (official doc, changelog, release, security advisory).
  "Most recent" doesn't mean "better".
- Test an update in an isolated phase, with tests and rollback, before promoting.
- New recurring tool: document where the project keeps it, and in the verification docs if it affects
  how "done" is proven.

---

## 7. Environment

The shell, encoding and git index traps — the ones that cost a whole session when they hit — are in
[06-ambiente.md](06-ambiente.md). Read before writing a script, a hook, or touching the index.

**A credential that the permission classifier blocks is not worked around.** A measurement that
requires a live token (from the browser profile, from the decider's session) becomes a **ready-made
script, with a click-by-click walkthrough for the owner to run** — the script prints the state
(exists or not) and, at most, a hash prefix, **never the secret**. Record in the ledger that the
measurement was left with the owner and what it decides.
