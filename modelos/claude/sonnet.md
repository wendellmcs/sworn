# Claude Sonnet - usage guide
model: claude-sonnet-5-5
source: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5.md | read 2026-11-13 | fingerprint c3197181ae54c77e
source: https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5.md | read 2026-11-13 | fingerprint b5438bded2c7f53f

## What it is for
- Pick it when you want the best combination of speed and intelligence. [1]
- For the hardest long-horizon work, an Opus model is the better choice. [2]
- Finding vulnerabilities in source code is allowed; high-risk dual-use cyber work is not. [3]

## Recommended effort
- Agentic coding: medium for well-specified tasks, high for harder or longer ones. [4]
- At low effort it can skip verifying a change. [5]
- At low and medium on long tasks it is more likely to stop and check in early. [6]
- Reserve xhigh and max for work where a quality gain was measured. [7]
- For less thinking, lower the effort level instead of asking in the prompt. [8]

## What to ask
- Focused coding changes: it generally checks its work before reporting done, but at low effort it sometimes skips a check that exercises the change. [9][22]
- Source-code vulnerability review. [3]
- Researched work such as a report or comparison from current sources. [10]

## How to ask
- When you change code that can be run, built, or type-checked, run a real check that exercises the change before reporting it done. [12]
- A syntax-only check, or one that failed to start, does not count. [13]
- If no real check can run, say which one you skipped and why. [14]
- Keep working until all that was asked is done; ask only when blocked or before a risky step. [15]
- When the work is done and checked, stop and report. [16]
- Mention extra features, tests, or refactors at the end instead of doing them. [17]
- With a search tool, for researched work such as a report or a comparison, gather current sources rather than writing from training knowledge. [10]
- If a deeper review is worth doing, say so at the end. [18]
- When the user asks for ideas, options, or a plan, give them that and stop. [23]

## What to avoid
- It tends to add tests, docs and small supporting files that fit the repository, even unasked; ask for only what was requested if you do not want them. [11]
- Do not pause to confirm a plan or ask a question you could answer yourself. [19]
- Do not use prompt wording that discourages tool use. [20]
- Do not ask for its reasoning in the response; it invites refusals. [21]
- Do not start extra review rounds at xhigh or max unless asked. [18]

## Citations
[1] source 2: "Claude Sonnet 5.5 offers the best combination of speed and intelligence"
[2] source 1: "For the hardest long-horizon work, an Opus model is the better choice"
[3] source 1: "Finding vulnerabilities in source code is allowed"
[4] source 1: "For agentic coding and multistep tool use, start at medium for well-specified tasks and move to high for harder or longer ones"
[5] source 1: "it keeps its thinking short and can skip verifying a change"
[6] source 1: "it’s more likely to stop and check in with the user before it completes its work"
[7] source 1: "Reserve xhigh and max for work where"
[8] source 1: "To get less thinking, lower the effort level"
[9] source 1: "Claude Sonnet 5.5 generally checks its work before it reports a change as done"
[10] source 1: "gather current sources rather than writing from your training knowledge"
[11] source 1: "The model tends to add tests, documentation, and small supporting files that fit your repository"
[12] source 1: "When you change code that can be run, built, or type-checked, run a real check that exercises the change before reporting it done"
[13] source 1: "A syntax-only check, or a check command that failed to start, does not count"
[14] source 1: "say which one you did not run and why instead of reporting the change as done"
[15] source 1: "Keep working until everything the user asked for is done"
[16] source 1: "When the work the user asked for is done and checked, stop and report"
[17] source 1: "If you think one would help, mention it at the end instead of doing it"
[18] source 1: "If you think a deeper review is worth doing, say so at the end"
[19] source 1: "It might pause to confirm a plan, ask a question it could answer itself"
[20] source 1: "check your prompt for language that discourages tool use"
[21] source 1: "If your prompts ask the model to include its reasoning in the response, remove those instructions"
[22] source 1: "At `low` effort, though, it sometimes reports a change as done without running a check that exercises it"
[23] source 1: "When the user asks for ideas, options, or a plan, give them that and stop"
