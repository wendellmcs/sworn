# Verification and evidence

The concrete command that proves a done in this project is in `{{campo:provaDePronto}}`. This file
covers what counts as proof, and how not to be fooled by your own instrument.

---

## 1. What counts as evidence

- **Fresh**: output from the current run, pasted into the answer. Memory of an earlier run is not
  evidence.
- **Complete**: if a command failed, paste the failure. Silence about a test amounts to claiming it
  passed.
- **Declared**: what didn't run is listed as not run, with the reason (environment, credential,
  missing tool).
- **It is output, not source code.** Pasting the program's excerpt doesn't prove it ran. What proves
  it is what it printed.
- **It is a trace, not prose.** "The gate blocked me" is the model's account. The counter written to
  the file, the exit code, the log line — that is evidence. When it is possible to leave a trace on
  disk, prepare the trace **before** the run; that is what turns an account into proof.
- **Measured number: edit, count, write — in that order.** A number that describes a file (lines,
  cap headroom, count) is taken **after the last edit**, never together with it: the fix that touches
  the file invalidates the measurement that goes with it. **Count by script**, with the test's
  method, never by `wc -l` nor `grep -c` (which counts lines, not occurrences). A list inside the
  document itself is also counted by script, after it is written.
- **Page screenshot: use the debugging protocol (CDP), not the command-line headless browser.** The
  headless browser called from the shell may return exit 0 before writing the file (the following
  `ls` says "does not exist" and looks like a failure), ignore the URL anchor and not write a very
  tall page — measured in a browser on Windows; exit 0 doesn't prove the screenshot, the opened file
  does. CDP, on its own port and waiting on a condition, not on time, takes the screenshot that was
  asked for.

**One line of output is enough.** A short answer is not an answer without proof: a one-line block
satisfies the gate, and it is cheaper to paste the proof than to fix later a claim that lacked it.

---

## 2. The gauge rule — planted mutation

**Every new gauge needs a control that flags a planted mutation. Without that, the number is worth
nothing.**

It applies to: counting script, new test, ratchet, lens that measures, grep that supports a
conclusion, anything that produces a number that will be used to decide.

The procedure is short:

1. Run the gauge in the current state and note the number.
2. **Plant on purpose** the defect it should catch — one line, in one file, reverted right after.
3. Run again. **The number must change, and change in the right direction.**
4. Revert the mutation and confirm the number went back.

If the gauge doesn't flag the planted mutation, it isn't measuring what you think it measures — and
every number it has already given is under suspicion, including those that confirmed what you
expected.

**The mutation has two proofs.** Deleting **all** the occurrences of what the test watches proves it
*knows how* to fail; deleting **only the occurrence that carries the meaning** (the warning, the
rule, the option) proves it looks at the *right place*. If the second survives, the assertion looks at
the whole text and is satisfied with the same word at another point. That is where the locality probe
usually finds the looseness: the fixture that gives the right order by chance, the one-sided negative
control, the success phrase that is always printed.

**A new test written red on purpose can hide its own false positive.** It goes red for two reasons
and the prototype shows only one: after writing the fix, **run the test against the right text or
code** before closing the list of reds. Every new comment that asserts an order ("X comes before Y")
gets a probe that swaps X and Y.

**Verify the instrument before accusing the instrumented.** When the measurement contradicts what the
code seems to do, suspect #1 is the gauge, not the code. That order saves whole runs.

**Compare evaluated structure, never substring.** Counting text occurrences to conclude about
behavior is the most common and most convincing measurement error: the number looks good and is
wrong. Use a parser, AST, structured API — whatever the format offers.

**Your own measurement beats an opinion**, even an expensive opinion, even one marked P0. An opinion
that states a number is a claim about a measurement, not the measurement.

---

## 3. A ratchet is not an ordinary test

A ratchet is a test with a baseline: it doesn't ask "is it right?", it asks "did it get worse since
last time?".

When a ratchet flags a regression, the correct way out is to **remove the cause**, never to raise the
baseline. Raising the baseline is a recorded human decision — and the baseline file is usually being
edited by another front, which makes touching it an almost guaranteed collision.

---

## 4. Declare the limit before executing, not at close-out

Before promising evidence in the plan, check that it exists:

1. **is there a generator/tool for this area?**
2. **is the environment it requires up?** (port, credential, service, browser)

If either answer is no, **say in the plan, before starting**, which gate will run by code reading
instead of by artifact. Finding this out at close-out is already late: the plan promised a proof that
didn't exist, and what is left is choosing between delivering without proof or redoing the work.

**Code reading is not a consolation prize.** A well-instructed lens adds up the paddings of the chain
and checks the relevant properties — that answers "does it overflow?" with arithmetic. The artifact
answers better, but its absence doesn't excuse the question.

**Partial coverage is declared, never implicit.** If the tool covers 4 of the 12 areas, say which 4.
"I ran the visual" when the generator only exists for a third of the screens is a true statement that
communicates a falsehood.

---

## 5. New failure versus pre-existing failure

"It already failed" **requires proof**, and the proof is one of these two:

- the suite output **before** editing, pasted; or
- the demonstration that the files read by the failing test **are not in the diff**.

Without one of the two, "it already failed" is a guess — and that is exactly how a regression gets in
unnoticed, with the agent in good faith.

---

## 6. Proportionality

A change that could break the product requires a test proportional to the risk. The table of gates
per gear is in [01-marchas-e-gates.md](01-marchas-e-gates.md).

A rule with no exception: **if no test ran, declare explicitly that it didn't run.**
