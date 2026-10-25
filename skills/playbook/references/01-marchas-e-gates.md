# Gears and gates

Three gears of rigor. The gear is chosen in Step 0, before reading code, and is **declared in the
answer** ("Standard gear: scoped bugfix").

Reminder from `SKILL.md` §2: **the gear you classify is a floor, never a cap.** If the project declared
the `path → gear` map (`{{campo:marchas}}`), it wins, and always wins upward.

---

## Step -1 — who else is working here

**Before editing any file, in any gear**, run in the target repository:

```
git status --short
```

Every file already modified and not committed **belongs to another front of work** until proven
otherwise. It is not an abandoned draft, and it is not an invitation.

- **Do not edit a file that already shows as modified**, even if the change is "small" or "obvious".
- If the goal **requires** touching one of them: stop and take it to `{{campo:quemDecide}}` in the 3-option
  format (`SKILL.md` §7). That is their decision, not the agent's technical judgment.
- **Recheck at close-out.** The set changes during the task: another session opens a new file while this one
  works. The `git status` from the start does not count as evidence at the end.
- **List in the answer** the third-party files that were left untouched. This proves the check
  happened, and protects whoever comes next from thinking the diff is all yours.

**A workspace can have several repositories.** `git status` at the root **does not see** a nested
repository that has its own `.git`. Run it in each repo the task touches, and list the three states
separately. Trusting the root status and editing inside a child repo is how you edit, unknowingly,
54 uncommitted lines from another session.

**Signs that there is a concurrent session**, even if nobody warns: baseline file modified;
contract test modified with no corresponding code; stylesheet modified with no UI task
open; decision-log document growing.

### Append-only document with sequential numbering

Decision log, changelog, findings record: **read the last number on disk before writing**,
never in the handoff nor in memory.

```
grep -n "^[0-9]\+\. " <arquivo> | tail -3
```

A handoff is a photo of the past; with a concurrent session, it lies about the present — and two sessions
that read the same handoff write **the same number** for different decisions. If the collision has already
happened: renumber **yours** (the later one in the file) and **never touch the other session's text**.
Prove it with `git diff --numstat`: removals = 0.

**`git add` by name, always.** Never `git add .` nor `-A` — the tree has another front's file
all the time, and committing a shared file takes the other session's work along. That is the decision of
`{{campo:quemDecide}}`, not the agent's judgment.

**Never raise a ratchet baseline** to make a test pass. Besides masking debt, a baseline file
is precisely what a cleanup front is editing — touching it is an almost
guaranteed collision. The correct way out is to remove the cause.

---

## Gear 1 — Fast

**Trigger:** typo, interface text with no change of meaning, comment, docstring, local rename,
formatting, one-off config. **Up to 2 files.** Zero new logic. Nothing visible to the user changes
behavior.

**Agent:** the cheapest that solves it — mechanical-editing tier.

**Gates:**
- Smallest possible diff; file style preserved.
- `git diff --check` clean.
- Files changed listed in the answer.

**Minimum evidence:** the diff and the file list.

**Do not use Fast when:** the changed text is one of the product's canonical labels
(`{{texto:rotulosCanonicos}}`), or the config touched governs permission, build, publishing or an endpoint.
That is AAA. **A canonical label is not detectable by file path** — it is the agent who has to
recognize it, and that is why it is written here.

---

## Gear 2 — Standard

**Trigger:** bug fix with a known cause, feature of clear scope, refactor bounded to a
module, new test, technical documentation.

**Agent:** development tier. Escalates to deep reasoning if an architectural decision, a bug
of unisolated cause or a security risk appears.

**Gates:**
- Real context read before editing — code, not assumption.
- Smallest safe diff; names, IDs, storage keys and load order preserved.
- **One independent review**: another agent, without inheriting the first one's conclusions, looking at the diff.
  **No deterministic mechanism forces this** — it is the Standard-gear gate that depends most on
  discipline, and the first to vanish when haste tightens.
- The done-proof of the affected area — `{{campo:provaDePronto}}`.
- `git diff --check` clean.

**Minimum evidence:** output of the done-proof pasted, reviewer's verdict, file list.

**Rises to AAA when:** during execution any trigger of gear 3 appears. The gear can
rise midway; it never goes down.

---

## Gear 3 — AAA

**Trigger — any one of these:**

- user-visible change (UI, layout, state text, icon);
- release or version bump;
- contract change between systems (verb, auth, required field, response format);
- permissions, profiles, roles, admin screens;
- security, sensitive data, revocation, replay;
- broad refactor or one that crosses modules;
- **intermittent bug, or one that has already resisted an attempt**;
- execution of a stage of a long plan;
- any path that `{{campo:marchas}}` marks as AAA.

Note that **the three highlighted ones are not inferable from the file path** — "has already resisted an
attempt", "is a release", "is a stage of a long plan" are facts of the conversation, not of the disk. No mechanism
catches them; the agent has to declare.

**Agent:** deep-reasoning tier. The maximum tier at the critical gate — security, release
readiness, hard-to-reverse decision.

**Gates — all mandatory:**

1. **Plan written before editing**: goal, out of scope, likely files, risks, acceptance
   criterion. For a long plan, **re-read the plan excerpt in the file**, never from memory nor from the
   handoff.
2. **Count before the brief**: grep the whole repository, not only the files you already intend to
   touch, and put the per-file count in the brief. A brief with a wrong number produces wrong scope.
3. **Blind inspection loop** — the lenses of the change (ten for code, eight for screen), cap of 3
   rounds, stop at 2 dry rounds. See [03-inspecao-cega.md](03-inspecao-cega.md).
4. **The complete done-proof** — `{{campo:provaDePronto}}`, without stopping at the first error, to see
   all the failures at once. **Separate a new failure from a pre-existing one with evidence** — run
   before editing, or show that the files read by the failing test are not in the diff. "It already
   failed" without proof is an assumption, and that is how a regression gets in unnoticed.
5. **A handful of cited tests is not approval.** If the project's suite is large, passing three quick
   contracts gives an early signal and proves **nothing**: whole classes of error stay outside them.
   Only the complete done-proof closes the gate.
6. **Visual evidence when there is a visual change — if the project has a way to generate it.**
   **Step 0 of the gate, in this order:** (a) is there a generator for this area? (b) does the environment respond?
   If either answer is no, **declare in the plan, before executing**, that lens 3 will run by
   reading code and style. Discovering this at close-out is already too late — the plan promised evidence that
   did not exist. With a generator, screen regression is proven by **automatic comparison of screenshots before
   × after** of the same screens and viewports, pointing out what changed outside the request; without the instrument,
   declare that the comparison was by eye.
7. **Release gate** if the publishable artifact changed.
8. **Documentation in the same change set**: every new visible feature updates permissions,
   admin screens, help, tests and docs together. The pair "touched X, must have touched Y" is in
   [05-governanca.md](05-governanca.md).
9. **Human decision at close-out** when there is open risk, a product choice, or a release.

**Minimum evidence:** output of each command pasted, verdicts of the rounds with agent count,
path of the generated artifacts, and the list of what did **not** run with the reason.

**Close-out deliverable that does not block — usage-test script, for a new visible feature.** It is not a
gate: the close-out goes out without waiting for an answer, but the script goes to the owner along with it. The task the user
will do, in one sentence; 5 real users, one at a time, doing it without help while someone watches
silently; note where each one got stuck. Five find most of the usability problems (about 85%, by the
Nielsen and Landauer curve); more than that repeats what was already seen.

---

## Doubt rule — the two axes

| Axis | Rule |
|---|---|
| Which **model** to use | When in doubt, the cheapest. Agents escalate on their own. |
| Which **gear** to apply | When in doubt, the strictest. |

They are not the same decision. A cheap agent executing an error-state text on a visible screen is
a cheap model in AAA gear — full gate. That is the correct design, not a contradiction.

---

## Delegation

- Conversational questions or ones already known how to answer: answer directly, without delegating.
- **Search and reading go to the cheapest rung that can read** — locate a file, find a function,
  answer "where is X", map structure. It is the delegation easiest to forget, and the cheapest.
- **An agent that edits by exact text match does not go to the cheapest rung**, but to the middle
  one. A failed edit becomes an escalation, and escalation redoes the whole task: a single rework cancels
  the price difference between the two rungs. Search and reading, which do not edit, stay on the cheapest.
- **A subagent that falls over with a usage limit (error 429) does not wait for the reset: relaunch the same brief on another
  model.** The limit is per model, and switching unblocks at once. Record that the round changed model and
  **count the fallen agent** in the declared total — cost is information. A cheaper model fits a verification
  round, with a specific question and facts already proven in the brief; not the first round, which
  is the one that discovers.
- Independent tasks can go in parallel to different agents, in a single dispatch.
- After delegating, **pass the relevant result on to the user** — the subagent's report does not appear
  to them. No mechanism guarantees this; it is a text rule and it vanishes if not remembered.
- **A subagent report is a claim, not a fact.** Check it before acting on it — above all
  when the opinion contradicts a measurement of yours. See the meter rule in
  [04-verificacao.md](04-verificacao.md).
- If subagents are unavailable, apply the same cycle in the controlling agent — isolated
  task, explicit self-review, verification — and **record the limitation**.
