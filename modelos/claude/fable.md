# Claude Fable - usage guide
model: claude-fable-5-2
source: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2.md | read 2026-11-13 | fingerprint c20db12661c1cea8
source: https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2.md | read 2026-11-13 | fingerprint cebf978deb078d4e

## What it is for
- Pick it for demanding reasoning and long-horizon agentic work. [1]
- For most workloads start with the latest Opus; move up when Opus at higher effort still falls short. [2] [3]
- It works well on long asynchronous tasks where nobody needs frequent updates. [4]
- It did well as planner and orchestrator for other models. [5]
## Recommended effort
- Start at high, the API default; most of the capability gain is already there. [6] [7]
- Use high for hard coding, research, agentic work and long unattended runs. [8]
- Use xhigh only for the hardest long-running work, where a gain was measured. [9]
- Use low for well-specified, high-volume tasks. At low and medium it is more likely to stop early. [10] [11]
- Asking it not to stop early raised output tokens by about 30 percent and still let through endings that list what remains. [17]
## What to ask
- Hard coding, research and agentic work. [8]
- Long autonomous runs, since it works well on long asynchronous tasks. [4]
- Consolidating duplicated code only when told the code is its own; that cost about 70 to 80 percent more output tokens, brought changes nobody asked for and, in some runs, changed an existing feature. [12] [13] [14]
## How to ask
- At low or medium effort, avoid stopping while you still owe work the user asked for. [15] [16]
- Diagnose errors and timeouts, then work through them before stopping. [18]
- Leave deliberate blockers alone and report them plainly. [19]
- Confirm before risky or destructive actions. [20]
- Say in a line what you will do before the first tool call. [21]
- Make the final report stand on its own, key points first. [22] [23]
- Review the diff against the closing summary; it often left out small changes. [24]
- Write exceptions, not absolute "never" rules, e.g. "ask for approval before deleting files". [25] [26]
## What to avoid
- Do not tell it to answer without deliberating; lower the effort instead. [27]
- Do not show it a large token budget on coding tasks at high or xhigh effort; removing one lowered cost. Test without it (prompt text, not API task budgets). [28] [29]
- Do not give hard prose limits; they can make its writing choppy. [30]
- Do not add the ownership sentence where changes must be minimal. [31]
- Do not edit earlier turns; keep the history append-only. [32]
## Citations
[1] source 2: "Claude Fable 5.2 is built for demanding reasoning and long-horizon agentic work"
[2] source 2: "For most workloads, start with the latest Claude Opus model"
[3] source 2: "move to Claude Fable 5.2 when your evals on a Claude Opus model at higher effort"
[4] source 1: "Claude Fable 5.2 works well on long-running asynchronous tasks"
[5] source 1: "Early testers had good results with Claude Fable 5.2 as the planner and orchestrator for other models."
[6] source 1: "Start at high, the default for Claude Fable 5.2 on the Claude API."
[7] source 1: "You get most of the capability gain when using high effort."
[8] source 1: "high suits hard coding, research, agentic work, and long unattended runs."
[9] source 1: "xhigh is for your hardest long-running coding and agentic work"
[10] source 1: "low suits quick back-and-forth, well-specified tasks, and high-volume workloads"
[11] source 1: "The model is more likely to stop early at lower effort levels."
[12] source 1: "it often consolidated duplicated code and sometimes made related fixes without being asked"
[13] source 1: "output tokens rose by about 70 to 80 percent and the model made changes nobody had asked for"
[14] source 1: "In some runs, it also changed how an existing feature behaves."
[15] source 1: "Please avoid stopping while you still owe work the user asked for."
[16] source 1: "This happens more often at `low` and `medium` effort."
[17] source 1: "but not endings that list what remains and then stop. Output tokens rose by about 30 percent."
[18] source 1: "Diagnose them first, and when they are not real blockers, work through them with the access you have"
[19] source 1: "leave it alone, say plainly what you found, and look for another safe way to finish the task"
[20] source 1: "This does not override the need for confirmation on risky or destructive actions."
[21] source 1: "Before you start, say in a line what you're about to do"
[22] source 1: "Close with a short recap that stands on its own"
[23] source 1: "Put the key points in the first few sentences."
[24] source 1: "A closing PR summary from Claude Fable 5.2 often left out small changes, so review the reported diff and the summary."
[25] source 1: "The model treats an instruction that contains "never" as absolute."
[26] source 1: "write "ask for approval before deleting files" instead of "never delete files""
[27] source 1: "Remove such lines and lower the effort level"
[28] source 1: "In Anthropic's testing on coding tasks at `high` and `xhigh` effort, removing a large budget lowered cost, with equivalent performance."
[29] source 1: "Test your tasks without it."
[30] source 1: "can make its prose choppy."
[31] source 1: "Leave the ownership sentence out where the user owns the code and wants it changed as little as possible."
[32] source 1: "keep the history append-only."
