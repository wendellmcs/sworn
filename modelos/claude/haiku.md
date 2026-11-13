# Claude Haiku - usage guide
model: claude-haiku-5-5
source: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5.md | read 2026-11-13 | fingerprint f0e4031394a042f1
source: https://platform.claude.com/docs/en/models/haiku-5-5/whats-new-haiku-5-5.md | read 2026-11-13 | fingerprint 191496380d56ee22

## What it is for
- Pick it for high-volume, latency-sensitive work: classification, routing, extraction and subagent tasks. [1]
- For xhigh or max effort, the guide says to also compare against Claude Sonnet 5.5 on performance, cost and speed. [2]
## Recommended effort
- medium is the default and the place to start for most work, including agentic coding. [3]
- low suits chat, short tool tasks and simple high-volume requests, but in long agent prompts it more often skips a search, stops early or skips a check. [4] [5]
- high suits knowledge work, longer agent tasks and strict instruction following. [6]
## What to ask
- Classification, routing and extraction. [1]
- Agentic coding, starting at medium effort. [3]
- Subagent tasks inside a larger agent. [1]
## How to ask
- Keep working until everything the user asked for is done; stop to ask only when you can't go on without the user or before a risky step. [7]
- Stop and report once the work is done and checked. [8]
- Mention useful extras at the end instead of doing them. [9]
- When you change code that can be run, built, or type-checked, run a real check that exercises the change before reporting it done. [10]
- Treat a syntax-only check as no check. [11]
- If no real check can run, say which one you did not run and why. [12]
- If you have a search tool, search before answering anything that may have changed since training; facts that can't change need no search. [13]
- With thinking off and JSON output, call a tool you need first, with no text before the call, and write the JSON after the results. [18]
## What to avoid
- Do not rely on telling the model to answer directly to cut thinking; lower the effort instead. [14]
- Do not add blanket search rules such as searching on every present-day question. [15]
- Do not put user text inside a tool_result block; the model may ignore it. [16]
- Do not pass temperature, top_p or top_k. [17]
## Citations
[1] source 2: "built for high-volume, latency-sensitive work such as classification, routing, extraction, and subagent tasks"
[2] source 1: "also run your evals on Claude Sonnet 5.5 and compare performance, cost, and speed"
[3] source 1: "is the default. Start here for most work, including agentic coding."
[4] source 1: "Use it for chat, short tool tasks, and simple, high-volume requests."
[5] source 1: "the model is more likely to skip a search, stop early, or skip a check at this level"
[6] source 1: "suits knowledge work, longer agent tasks, and strict instruction following."
[7] source 1: "Keep working until everything the user asked for is done, and only stop to ask when you can't go on without the user or before a risky step."
[8] source 1: "When the work the user asked for is done and checked, stop and report."
[9] source 1: "If you think one would help, mention it at the end instead of doing it."
[10] source 1: "When you change code that can be run, built, or type-checked, run a real check that exercises the change before reporting it done"
[11] source 1: "A syntax-only check, or a check command that failed to start, does not count"
[12] source 1: "say which one you did not run and why instead of reporting the change as done."
[13] source 1: "search for those before you answer, even when you feel sure. Facts that can't change need no search."
[14] source 1: "To get less thinking, lower the effort level."
[15] source 1: "that instruction made the model search on half of the prompts that needed no search"
[16] source 1: "Never put user text inside a tool_result block."
[17] source 2: "Omit temperature, top_p, and top_k."
[18] source 1: "When you need a tool, call it first, with no text before the call, and write the JSON once you have the results."
