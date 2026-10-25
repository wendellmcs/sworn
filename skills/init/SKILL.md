---
name: init
description: Sets up sworn in this project. Scans the repository, shows what it inferred, asks six questions no scan can answer, and writes .claude/sworn/projeto.json and regras.md. Use on first contact with a repository, or when the project changes shape.
argument-hint: "[project path, if not the current one]"
---

# `/sworn:init` — the interview

You are setting up `sworn` for this project. **Scan first, ask later.**
Never ask what the scan already answered.

**The project root** is the path the user passed as an argument; with no argument, it is the current
folder. **Every path in this script is relative to it** — not only the `<raiz>` in the commands, but also
`.claude/sworn/projeto.json` and `.claude/sworn/regras.md`, the two files this script
**writes**. The `Write` tool wants an absolute path: build it from the root, never from the current
folder. Configuring one project and writing into another is the error this rule exists to prevent — and
writing `regras.md` is the more dangerous of the two, because no later step checks it.

**One exception, and only one:** `${CLAUDE_PLUGIN_ROOT}` is the **plugin** folder, a different tree, unrelated
to the project being configured. It is substituted at invocation — write it verbatim, and do not
anchor it to the root.

**A path always goes in SINGLE quotes** — `'like this'`, never `"like this"`. Double quotes expand
variables in both shells, and a root named `proj$dev` becomes `proj`: measured, the command reads the
**sibling folder** and returns `exit 0` without a single line of error. A name with an apostrophe is the only special case — double it
to `''` in PowerShell, and write `'\''` in bash.

## Step 0 — resolve the root and show it to the user

**Before anything else.** Turn the root into an **absolute** path, confirm it is a
**folder**, and **tell the user which one it is**. All the following commands use this absolute form, not
what the user typed.

    (Resolve-Path -LiteralPath '<raiz>').Path
    Test-Path -LiteralPath '<raiz>' -PathType Container

    realpath -- '<raiz>' ; test -d '<raiz>' && echo E-PASTA || echo NAO-E-PASTA

Three reasons, all measured:

- **A relative root operates on the wrong folder and nobody notices.** If the owner passes `alvo` and an
  `alvo` exists in the current folder, the scan measures the current folder, the listing lists the current folder,
  and Step 7 ends with `OK` — while the real project is still unconfigured.
- **The output of Step 2 does not say which folder was scanned**, in any field. If you don't show the root
  now, the first sign that it was wrong shows up five steps later.
- **A root that is a file, not a folder, goes unnoticed:** the listing command returns one
  line and `exit 0`. `Test-Path -PathType Container` and `test -d` answer `False`/`NAO-E-PASTA`.

If the root does not exist or is not a folder, **stop and ask**. Do not try to guess which one it was.

## Step 0b — is there already a configuration here?

Read `<absolute root>/.claude/sworn/projeto.json`. **If it exists, this is a re-init** (a
reconfiguration: `/sworn:init` running on a project that has already been configured) **and the script changes:**
you are not configuring a new project, you are updating someone else's. When talking to the owner, say
"reconfiguration"; "re-init" is just the name this script uses.

Tell the user, in two lines: that a configuration already exists, how old it is (the `geradoEm` field), and
what is about to happen.

**Three rules that apply only in a re-init:**

- **Ask only what makes sense to ask again.** What he doesn't answer again **stays as it is**.
  Do not reread the whole list of six questions to him: that is asking him to redo the work.
- **Show what changed before writing.** No script compares them: you do. Before the
  `Write`, put the current `projeto.json` side by side with what will be written, and show **two lists**: the
  fields whose value changed and the answers that **did not fit in any field** (the answer's name
  is not a key of `projeto.json`). **Preserve what the interview did not ask again:** keys
  set by hand that `projeto.json` already has, the `limiares`, the `travas`, the `marchas` and the `agentes`
  not repeated (init only writes `agentes.escada`, the list of agents from cheapest to most expensive, and
  `agentes.degraus`, the name and the model alias of each rung of that ladder; other sub-keys set by hand
  survive; a partial answer is merged by key, it does not replace the whole object) and any other field
  left unanswered. **Show both lists.** An answer silently discarded is the failure this plugin
  exists to stop.
- **The `regras.md` of Step 6 is not overwritten.** It may have been edited by hand since.
  If it already exists, say so and move on.

**Before any `Write` in `.claude/sworn/` (the `projeto.json` of Step 7, the `design.json` of
5b if you are going to write it, the `regras.md` of Step 6 if it no longer exists), declare the scope.** Three
terms, in plain words: the **scope gate** ("trava 4" in the gate's message) is the protection that only lets a file be written
if the declared scope of the task covers it; the **scope** is the file `.claude/sworn/escopo.md`,
the list of what this task may edit; and the **gear** is the level of rigor that `projeto.json` gives to
each path (`padrao` requires a declared scope, `rapida` does not; Step 5 details it). In a re-init the
`projeto.json` is already on disk, so the gate is up — and in `padrao` gear, with no scope, it
**denies** those `Write`s (measured; it is the same trap that Step 7e describes further on).
**Tell the owner, in plain words, that you are going to create or extend `.claude/sworn/escopo.md`, only
so you can write the configuration, and that you will take back whatever you add to a scope that already belonged to
another task.**

First put `.claude/sworn/projeto.json` and `.claude/sworn/regras.md` in the "Dentro" section of the scope
— and `.claude/sworn/design.json` **only if 5b is going to write it** (5b is optional) — because the gear map
this script recommends (`rapida`: `**/*.md`, `docs/**`) does **not** cover `.json`, and the map
may not even exist. The gate always lets `escopo.md` and the front file (below) through, without requiring a
scope: you can edit them before any other `Write`. If
`.claude/sworn/escopo.md` already exists (it belongs to another task in use), **add** those lines to its
"Dentro" section with `Edit`, without deleting the rest; only create the file if it does not exist — and, if init
created it, it is just scaffolding so the configuration can be written: **Step 8 removes it** (a leftover
scope file starts restricting the `padrao` gear after init). If it exists but
has no "Dentro" section, create the section. If the session is bound to a front (the own scope of a
parallel line of work, in `.claude/sworn/escopos/<frente>.md`, see "With more than one
front"), that is the file you add to.

**In Step 8, before closing, remove again the lines you added** (with `Edit`; the file
belongs to another task, and leaving them there widens its scope forever). **An init interrupted before
Step 8** (the owner gave up, the session closed, you stopped without `OK` in Step 7) leaves those lines in the
other task's scope. So: tell the owner, when adding, which lines they were; if you
yourself are going to stop before Step 8, remove them before stopping; and **when resuming an interrupted init**, the
first step is to open the scope in force and remove (with `Edit`, only them) the lines that init
added — `.claude/sworn/projeto.json`, `.claude/sworn/regras.md` and, if it applies,
`.claude/sworn/design.json` in the "Dentro" section. If you doubt whether one of them already belonged to the other
task, ask the owner before removing. **If init created `escopo.md` itself** (it
did not exist before), an interrupted init leaves it on disk: when resuming, if the file only has init's
lines, remove the whole **file** (as Step 8 describes); if it has more than that, ask the
owner.

The gate only sees the `Write` and `Edit` that **you** do. The generators of Steps 7b, 7c and 7d write
by script (`--gravar`), outside it, so this scope does not need to cover `.claude/agents/`, the project's skill
or `AGENTS.md`.

After writing, **run the Step 7 validator the same way** — and paste the output. A re-init that
fails is a configuration that protects less than it appears to, exactly as in the first init.

## Step 1 — declare the cap BEFORE scanning

Tell the user, in one line, what is going to happen and what the limit is. Do not scan before saying so.

> I'll list the repository's paths, with a cap of 4000 files and 8 levels of depth,
> skipping `node_modules`, `.git`, `dist` and the like. In this scan, as for contents, I only open `package.json`, to find
> the test command; `.claude/settings.json`, `.claude/settings.local.json` and `.mcp.json`, to
> see what the environment already has; and the project's instruction files, only to count lines.

The text above is what the Step 2 command actually does, and it is what the command itself declares in the field
`teto.observacao` (there, the reading of `package.json` only appears if it exists). Promising "I only read
`package.json`" or "no file contents" and then pasting an output that says the opposite is the
family of defect this plugin exists to stop. The limit applies **only to the scan**, not to the whole
script: Step 5b reads the token files that the owner confirms, and Step 7 reads
`scripts/lib/projeto.js` from the plugin. Do not promise "only this" for the whole init; warn when you reach those
steps.

## Step 2 — scan

Run, with the project root in place of `<raiz>`:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/varrer.js" '<raiz>'

Show the user the `teto` block of the output — how many files were read, whether it truncated, and the token
estimate. **Cost is his information, not a detail.**

## Step 2b — what already exists here, and what sworn will NOT duplicate

Read the `ambiente` block of the scan and show the user, in a table: active plugins, skills, agents,
hooks already configured and MCP servers.

**Rule:** what already exists is **not duplicated**. If `superpowers` is installed, the method
(brainstorm, plan writing and execution, TDD, debugging) is its own — `sworn` demands proof, it does not
teach method. If `context7` is installed, library verification is its own.

**If a hook is already configured in `.claude/settings.json`**, warn: `sworn` adds its own
hooks and both will run. Ask whether either should go, and **do not turn anything off on your own.**

## Step 2c — the instruction weight this project already carries

Read the `instrucoes` block of the scan and show: total, the three heaviest files, and the cap.
**Give the method together with the number** — a number without a method is opinion with decimal places.

If `instrucoes.fontes` comes back `candidatas`, there is no `projeto.json` yet: the number counts the
canonical-source candidates the scan found, not yet confirmed (question 2 of Step 4
confirms them). **Tell the owner this together with the number.** If it comes back `declaradas`, the number counts the sources the
owner already declared.

- Below the warning: carry on.
- Between the warning and the cap: say it is close, and that each new rule competes for attention.
- **Above the cap:** stop and take it to the owner in 3 options. Adding a rule to a project that has already exceeded
  the cap worsens adherence to all the others — it is deliberately feeding the failure the cap exists to contain.

## Step 3 — show what was inferred, marked as inference

Present the `inferido` block in a short table, and say explicitly that it is inference:

| What | Inferred |
|---|---|
| Language | … |
| Package manager | … |
| Command that checks the project (`provaDePronto`) | … |
| Platform / shell | … |
| Canonical-source candidates | … |
| Design system | … |
| Is it in a git repository? | … |
| Files already modified now | … |
| Complete list? | … |

Where the value is `null`, say "I couldn't infer it" — **never fill in a guess.**

**`modificados` has three answers, not two.** A list with names: there is work from another
front open here — tell the user now, don't let him find out when a gate denies something.
Empty list: the tree is clean. **`null`: I couldn't take the snapshot** — no git, outside a
repository, or the command failed; in that case say that I don't know, **never "nothing modified"**.

**If `temGit` is `false`, warn that one of the four protections goes mute in this project** — the one that
prevents writing to a file that was already being touched when the session opened. With no git there is no opening snapshot,
and with no snapshot it has nothing to compare against. Say this in words, not by the internal name of the
lock: the user will only see that name at the close-out. Promising a protection that the project's structure
does not sustain is lying with a table.

**If `inferido.listaIncompleta` is `true`, say so BEFORE the table**, with the
`motivosIncompleta` up front: the scan did not see the whole repository, and every `null` or `false`
below may mean "doesn't exist" or "didn't look". If it is `null`, say it cannot be known. Treating a truncated list
as a complete one is the failure this warning exists to prevent.

## Step 3b — the second cap: only the first level

The scan **does not return the list of the repository's paths** — it returns a count, inference, and as
paths only what it recognized itself: `candidatosCanonicos` and `modificados`. Neither of them brings
a folder name like `segredos/`. Without that list, question 4 of Step 4 would ask the owner to remember the paths from memory,
and a wrong path (`segredo/**` instead of `segredos/**`) becomes an **inert** pattern: it matches nothing and protects nothing.

Declare the second cap with the same honesty as Step 1, and only then list:

> Now I'll list **only the first level** of <the absolute root you showed at the start> — the names
> that are there, without entering any subfolder and without opening any file — so I can offer you what
> must not be touched.

List **one level, no recursion, at the absolute root of Step 0**, with the shell that the scan inferred in
`inferido.plataforma.shell` — and, if that command fails, use the other one; `plataforma.shell` is
a guess about the operating system, not a measurement of the shell you have:

    Get-ChildItem -Force -LiteralPath '<raiz>' | ForEach-Object { if ($_.PSIsContainer) { "$($_.Name)/" } else { "$($_.Name)" } }
    ls -A1F '<raiz>'

Three details of those commands are not style — they are what makes them work, and each one was measured:

- **The single quotes.** With double quotes, a root `proj$dev` becomes `proj` in both shells and the command
  lists the **sibling folder**, with `exit 0` and no error. With no quotes at all the failure mode **varies with the
  name**: sometimes it fails loudly (`cannot access`, `exit 2`), sometimes it returns an empty list with success,
  and sometimes it silently lists another folder. That is why the quote is not optional — you can't
  recognize the error by its look.
- **`-LiteralPath`, never `-Path`.** `-Path` treats a bracket as a search pattern: a root named
  `projeto [v2]` returns an **empty list, with no error, with success**. Then the rule "if it fails, use
  the other one" doesn't save you, because nothing failed.
- **The type mark.** Question 4 needs to know whether each name is a folder or a file, because the shape of the
  pattern changes, and ambiguous names are common (`credenciais` may be a file, `chaves.d` may be a folder). In
  PowerShell the slash comes from `PSIsContainer`, which is reliable. **In bash, careful:** `-F` marks
  `/ @ * = | >`, and **only the slash means folder**. A shortcut to a folder comes out as `nome@`, an
  executable as `nome*`. Treat `@` as "I don't know" and **ask**; strip any other mark from the name
  before writing the pattern. A shortcut read as a file becomes a pattern that doesn't protect the contents:
  measured, `atalho-segredos` does not match `atalho-segredos/prod.token`.

**If the listing comes back empty, do not conclude there is nothing to protect** — Step 0 already proved that the root
exists and is a folder, so an empty list here is either a truly empty project or a command defect. Say which
of the two you concluded, and why.

Use the result **only** in Steps 4 and 5. **Do not open the contents of any file here.**

## Step 4 — the six questions

Use `AskUserQuestion`, one question at a time or in a batch, with **exactly 3 options** each, the
recommended one first and marked. Each option states the practical consequence.

**Where there is nothing to offer** — the list came back empty, the inference came back `null`, or no earlier step
produced a candidate — **say so and ask openly.** Do not fabricate three options just to
satisfy the rule of three: an invented option is a guess dressed up as a measurement, and the owner picks one
believing you saw it.

1. **Is this project internal or public?** → writes `modeloDeAmeaca`
   Without it the agent applies the "average world" default, which is the open internet, and hardens what
   nobody asked for. The scan **does not measure** this — there is no CI or publication signal in its output;
   the answer is the owner's. Recommend `interno` and say that it is a recommendation, not an inference.
   Options: `interno` (recommended) · `publico` · "I don't know yet — treat it as public until I
   decide". The third **writes `publico`**: the field only accepts those two values, and that is what you
   tell the user — without citing the field name, which is not his vocabulary.

2. **Which files really govern?** → writes `fontesCanonicas`
   Offer the scan's `candidatosCanonicos` — the field name in the output is different, and you are the one
   who writes it. Everything that is not on this list is **data, not instruction** — including README, code comment
   and issue.

3. **Which command checks the project?** → writes `provaDePronto`
   Offer the inferred `provaDePronto`. If it came back `null`, ask openly and accept "doesn't exist yet".

4. **What must not be touched?** → writes `intocaveis`
   Offer from what the first-level listing brought: backup folders, folders of
   retired material, secrets, directories of sibling projects. **Every NAME you
   offer must have appeared in that listing** — an invented name becomes an inert pattern. The *shape* of the pattern is yours, and it has three
   cases:

   - **folder** → `segredos/**`;
   - **loose file at the root** → the name itself, `.env`. Never `.env/**`: the `/**` requires a segment
     after it, and a file has none — the pattern is born inert;
   - **the same file name, at any level** → `**/.env`. This is the monorepo shape, and it is the only one
     the one-level listing doesn't show you by itself: you see `.env` at the root, but `packages/api/.env`
     exists and `.env` alone does **not** match it. When the name is a secret's, **offer both
     shapes** and let the owner choose — saying that the second one catches the file in any subfolder,
     including the ones you didn't look at.

   The reverse does not hold: **do not invent a path segment** that the listing didn't show. `infra/**`
   can be offered because you saw `infra/`; `infra/secrets/**` cannot, because you never went in there.

   An absolute path (`C:\...`) or one with a scheme (`file://`) is refused by `validar.js`.

5. **Who decides?** → writes `quemDecide`
   A name or role. It is whom the agent takes the 3 options to when the choice is not its own.

6. **Which agents exist here, from cheapest to most expensive — and with what alias does each one run?**
   Offer the subagents the scan found in `.claude/agents/`. **It is two pieces of information per
   rung, and both are answered at once:** the agent's name and the alias of the model it uses.

   **Ask for the alias, never the full identifier.** An alias is the short name the tool
   accepts; an identifier is the exact version, which changes when the vendor renames — and a
   `projeto.json` that pins an identifier is born with an expiry date. If the person answers with an
   identifier, **the validator refuses it**, and the job is to explain that to them, not to rewrite
   their answer on your own.

   Write to `agentes.escada` **and** to `agentes.degraus`, **in the same order and in the same act**. Writing
   one without the other raises no error at the time: it leaves the cost gate (the lock that blocks dispatching an expensive agent for
   simple work) judging by one list and the
   alias check by another, in silence.

   If the project has no agents, **leave the list empty** — it is a legitimate answer, and the cost
   gate simply gives no opinion. **A single rung is not a ladder** and the validator refuses it: it is either
   two, or none.

## Step 4b — where each thing is recorded

This is **not** the seventh question of Step 4: those write a field of `projeto.json`, and the answer
here is not a field of it. The execution skill (`playbook`) looks for these three places in the `ondeRegistrar`
slice of the adapter; without an answer, it doesn't know where to send what was left over from a review
or the decision the owner made.

Use `AskUserQuestion`, **one question per place** (the three places below are not the 3 options: each
question has its own 3 options, as in the other questions), and ask for **one file for each**, so the
decision doesn't get lost inside a list of pending items:

1. the **record of decisions** of the owner (the file where each decision is kept with its date; the
   decision log);
2. the **still-open questions**;
3. the **progress record** of the plan in execution (the ledger: the file where each task of the plan
   notes what was done).

In the question to the owner, use the plain description in the user's language; the technical term only in parentheses.

**Offer only names that appeared in the first-level listing of Step 3b or in the scan.** With no
candidate, say so and ask openly (the Step 4 rule). **Do not create the files** — this step only
asks where they live.

**Where the answer goes:** to the `decisoes` slice of Step 7c, the project's skill, which `playbook`
reads in Step 0-bis. 7c uses the answer from here **without asking again**. If the owner chooses **Don't
save** for the skill in 7c, the 4b answer is not saved anywhere — **tell the owner this
at that moment**.

**In a re-init, first check whether the project's skill already exists** (list `.claude/skills/`: it is the folder with the
`SKILL.md` that an earlier init wrote through 7c, with the `decisoes` slice, and that says "Gerado por
`/sworn:init`"; with more than one like that, ask the owner which one it is), because 7c **does not write over it** (the
script refuses to overwrite a skill that already exists, item 6 of 7c):

- **exists and has all three files** in the `decisoes` slice: do not ask again; what is there stands;
- **exists without the three:** do this step, but the answer does **not** go through 7c. Show the owner the
  snippet with the three files for him to put in the `decisoes` slice of the existing skill — you don't edit it:
  in a re-init `projeto.json` already exists, and the scope gate may deny the write (the trap of
  Step 7e). **Warn that, until he puts the snippet in, the answer is not saved**;
- **doesn't exist:** do this step; the answer goes on to 7c.

**Last, the top reference** → writes `referencias` into `projeto.json` (optional key). It is not a place for
recording: it lives here so Step 4 can keep six questions. It is the best piece that exists for each type of
deliverable, `tela`, `codigo` and `texto`, on the market or in the project itself: `/sworn:review` puts it next to the
work, and the end of the turn blocks the delivery of the AAA gear that was not reviewed against it. One question only, via
`AskUserQuestion`, with 3 options. In the question to the owner, no jargon: "what is the best example that exists of what this
project delivers? The review will compare the work with it" — "gear" is only explained in Step 5.

The 3 options go to the owner with these labels and descriptions, already in his words (what comes after "Writes:" is
for you, it does not go into the option):

1. **Name it now (recommended)** — "You point to the best example of each type (screen, code, text): a file
   or a screenshot saved in the project. Every maximum-rigor delivery review compares the work with it." Writes:
   `referencias`, by type. The inspector only reads files: offer only paths that appeared in the Step 3b listing or
   in the scan; with no candidate, ask openly and offer `/sworn:reference`, which studies the leading products
   of the same type and writes the sheet that becomes the reference. If the owner only has a link, say that the inspector does not open the page and
   give the two ways out: save the page or a screenshot in a file of the project and give that path; or write the link
   anyway, knowing that this example stays out of the comparison until it becomes a file (`/sworn:review` warns about this
   on every review);
2. **Leave it for later** — "Nothing changes for now: the review compares only before and after. The next session reminds
   you once. To name it later, run `/sworn:init` again and answer only this question, or run `/sworn:reference`, which
   studies the best of the same type and brings the sheet." Writes: nothing (the key
   is left out, and the session opening warns once that it is missing);
3. **Never in this project** — "The review never compares the work with an outside example: it only sees whether the after
   got better than the before, not whether it measured up to the best that exists. The reminder stops." Writes:
   `"referencias": {}`, and the opening warning does not appear.

In a re-init, show the current `referencias` and ask only whether the owner wants to change it. The answer is merged with the one that exists,
type by type: the type the owner answers replaces its list, and the type he doesn't mention stays as it was. The exception
is option 3: **"never" in a re-init writes `"referencias": {}` in place of the whole key**, and the types that were
saved are removed (it is the only object where `{}` erases; in the others, `{}` changes nothing). To remove just one type, write
its list empty (`"tela": []`), which counts as no reference.

## Step 5 — the gear map

Before proposing, say in one line what the gear does — the user is going to confirm this map, and the
word alone means nothing to someone just arriving: **the gear decides whether `sworn` requires a
declared scope before letting that file be edited.** `rapida` does not require it; `padrao` and `aaa`
do.

And state the real size of the difference, instead of leaving it implied: `padrao` only requires the declared
scope. `aaa` requires the scope **and** the execution manual (the skill with "padrao" in its name) loaded in the
session before editing the file; turn it off with `"portaoManual": false`. With a top reference declared
for the file's type, `aaa` also demands at close-out the review against it (turn it off with
`"portaoReferencia": false`).

**The three keys are lowercase** — `aaa`, `padrao`, `rapida` — and all three must exist. The map
is **not** `path → gear`; it is gear → list of patterns, and that is how it is written:

    "marchas": {
      "aaa":    ["**/auth/**", "**/auth.*", "**/manifest.json"],
      "padrao": ["src/**"],
      "rapida": ["**/*.md", "docs/**", "LICENSE", ".gitignore"]
    }

Propose the content from the first-level listing and ask for confirmation. Proposal rules:

- **`aaa`**: authentication, permission, migration, API contract, release file — and these patterns,
  which match both the folder and the loose file: `**/auth/**`, `**/auth.*`, `**/security/**`,
  `**/security.*`, `**/*.gs`, `**/manifest.json`. **Folder and file need both patterns:**
  `**/auth/**` alone does not match `src/auth.js`, and `manifest.json` alone does not match
  `extension/manifest.json` — measured in this plugin's glob. These six are a security recommendation,
  not names seen in the listing: a gear pattern that matches nothing is harmless, unlike
  what happens in `intocaveis`.
- **`rapida`**: `**/*.md`, `docs/**`, `LICENSE`, `.gitignore`.
- **`padrao`**: the code.
- `marchaPadrao`: **`padrao`, always.** It is what decides the path that matched no list, and
  **when in doubt between two gears, go up.** The validator would accept `rapida` here — and then every unlisted
  file would stop requiring scope. Write `padrao`, and warn the owner that this key is the one not to
  be touched later without thinking.

## Step 5b — design system, when there is one

If the scan marked `temDesignSystem: true`, it only says it found a **signal**: a file or folder
whose **name** matches its pattern (`DESIGN.md`, `tokens.*` or `_tokens.*`, `design.tokens.*`, `design-tokens.*`,
`design-system-*`, `theme.css|ts|js`, `variables.css|scss`, or a `design-system` folder). It **does not
return any path.** Locate the files that match that pattern yourself — without entering the
folders that Step 1 skips (`node_modules`, `.git`, `dist`, `build` and the like) —, read them and **confirm
with the owner** that they really are the project's tokens (an authentication `tokens.ts` matches too). **Only
after asking the anti-references** (paragraph below) write `.claude/sworn/design.json` with
`cores`, `raios`, `espacos`, `sombras` and `antiReferencias`.
**In a re-init, the `Write` here is denied by the scope gate** if `escopo.md` does not cover that file:
declare it first, as Step 0b says. **If `design.json` already exists, do not overwrite it without
asking:** show the owner what changes (field by field) and only write with his OK.

**When the project has no design system, extract one from the components that already exist** — never
import an average taste. If it cannot be extracted, **do not create the file**: the module is optional and
doing without it is better than having an invented one.

Ask the anti-references: *"what must this interface not look like?"*. Saying what the thing **must not**
look like is verifiable; saying what it should look like is not.

## Step 5c — authorize parallel work, once only

The plugin ships the `/sworn:parallel` workflow (independent tasks in parallel, with a cap of 8
agents per dispatch, a cheap model and isolation for whoever edits) and a rule, at the opening of every
session, that tells Claude to **run it directly**, stating the cost, when there are 3 or more independent tasks.
Claude Code asks for approval before running a workflow; this step gives that approval **once**.

**1. Check before asking**, from inside the absolute root of Step 0:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/autorizar-paralelo.js" --conferir

If it comes back `"autorizado": true`, or if the current `projeto.json` already has `"paralelismo": false`, **do not
ask**: say in one line what is already in force and move on. That is what makes the question come up only once.

**2. Otherwise, ask with `AskUserQuestion`, in 3 options, the recommended one first:**

- **(a) Authorize in this project (recommended)** — writes the permission; from then on Claude runs
  parallel directly and states the cost in one line. Cost: each run spends the agents it dispatches.
- **(b) Ask on each run** — nothing is written; Claude Code shows the approval window every
  time (and a re-init asks again).
- **(c) Don't use it** — turns the rule off: `"paralelismo": false` goes into the `projeto.json` that
  Step 7 writes.

**3. In (a), write through the script, never through `Write`** (the file may hold other permissions of the owner, and the
script merges by JSON):

    node "${CLAUDE_PLUGIN_ROOT}/scripts/autorizar-paralelo.js"

It adds `Workflow(sworn:parallel)` to `permissions.allow` of `.claude/settings.local.json`
(the project's personal file, outside git). Output `"erro"`: do not write by hand; show the error to the owner.
**Tell the owner the limit that was measured:** the rule releases the workflow with no window in `claude -p` mode;
in the interactive session (terminal or VS Code), if the window still appears on the first run, he
chooses **"Yes, and don't ask again"** once and it does not come back in this project.

## Step 6 — seed the rules

**This step comes BEFORE writing `projeto.json`, and the order is not style — it is what makes the step
work.** The instant `projeto.json` exists on disk, the scope gate is up, and its
free pass is for the **file** `escopo.md`, and no other. `regras.md` would fall under the
`padrao` gear, with no declared scope, and the script would be **denied by the very gate it just
switched on** — measured. Seeding first, there is no gate yet: the step goes through, and the
gate is born with the rules already in place. **Do not swap these two steps.**

Copy `${CLAUDE_PLUGIN_ROOT}/modelos/regras.md` to **`<absolute root>/.claude/sworn/regras.md`**
— the root of Step 0, never the current folder. Build the path from the absolute root and **check before
writing**: a folder error here is only reported if the file lands where the next step looks.

Read with `Read` and write with `Write` — never `Copy-Item`, `Set-Content` or `Out-File`, for the same
encoding reason explained in the next step. Adjust only what is specific to the project (who
decides, proof of done, threat model). Do not invent a new rule here — a new rule comes in through
`/sworn:learn`, with approval.

**You will probably see a warning from `sworn` itself** saying that this project has no
`projeto.json` and that you should run `/sworn:init` — during `/sworn:init`. That is expected, and it is
precisely the proof that the order is right: the gate has not come up yet. Carry on.

**If the file `modelos/regras.md` does not exist**, tell the user and carry on — the next step's
configuration stands on its own, and the rules come in when the template exists. **Do not write an invented
`regras.md` in its place.**

## Step 7 — write and validate

Before writing, **read `${CLAUDE_PLUGIN_ROOT}/scripts/lib/projeto.js`** and use the constants
`CHAVES` and `TRAVAS` as the format — it is the only source of truth of the file, and it changes over time.
**Check your list against `CHAVES`, not against the list below:** that is what is known today, and the
code is what counts. Six values required there **come from no question at all**, and are yours:

- `versaoConfig`: `1`;
- `geradoEm`: today's date, `YYYY-MM-DD`. **Measure, don't remember** — run `Get-Date -Format yyyy-MM-dd`
  or `date +%F`. The validator checks that the date exists on the calendar, not that it is today: an
  invented date passes, and passes quietly;
- `plataforma`: the `inferido.plataforma` block of Step 2, with `so` and `shell`, both non-empty
  text. **It is the one that escapes most often**, because it appeared on screen back in Step 3 and did not come from any question
  — forgetting it makes `validar.js` fail with `falta a chave plataforma`;
- `comandosBloqueados` and `comandosLiberados`: empty lists — no question in this script
  fills them. **In a re-init, keep the values of the current `projeto.json`** (Step 0b);
- `travas`: all four, `true` by default. In a re-init, also keep those of the current `projeto.json`.

Outside `CHAVES`, the optional `referencias` (the `CHAVES_OPCIONAIS` list) goes in only through the answer at the end of Step 4b:
the paths by type, or `{}` for "never"; with "leave it for later", do not write the key. **In a re-init, start from the
current `projeto.json`'s `referencias`**: the type the owner did not change stays as it is (the per-type merge of
Step 4b), "never" writes `{}` in its place, and "leave it for later" keeps the current key — the `Write` rewrites the whole file
and would erase what was already saved.

**Where to write.** `<absolute root>/.claude/sworn/projeto.json` — the root of Step 0, never the current
folder. This line is the most important of this step; the next paragraph is about something else.

**In a re-init, before the `Write`:** the scope gate denies writing `projeto.json` without the
scope of Step 0b in place — check that `escopo.md` (or the front file) covers `projeto.json`.

**With what tool.** `Write`, always. **Never `Out-File`, `Set-Content` or `>`**: the encoding
they produce depends on the PowerShell profile, and there has been a case of UTF-16LE coming out, which is born
unreadable to the readers. The readers strip the BOM on purpose, but that is a courtesy of the code,
not a contract — and it is no reason to take the risk: it is here, at the source, that the file is born right.

Then, with the absolute root in place of `<raiz>`:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/validar.js" '<raiz>'

**Expect two `OK` lines, not one:** one for `projeto.json` and one for the `regras.md` you seeded in the
previous step (`OK: regras.md valido (N regras)`). That is why seeding comes first: that way the validator
checks both things at once. If the second line does not appear, `regras.md` is not where the
validator looked — go back to Step 6 and check the folder.

**Pass the root, never `.` or a relative path.** With `.`, the validator checks the project of the current
folder — which may not be the one you are configuring — and prints a relative path that does not
identify any project. It says `OK` for the wrong file, and the output you are going to paste here does not
give the mistake away.

**If `ERRO` comes out, fix it and run again.** Only move on with `OK` on screen, and **paste the output** in the response.
Fix **what is yours** — missing key, wrong type, malformed date, or **I wrote to the wrong
folder**: an `ENOENT` error means the file is not where the validator looked, and the cause
is almost always having written relative to the current folder instead of the root. **If the error comes from an answer of the
owner** (an `intocaveis` with an absolute path, a pattern that neutralizes another), **do not rewrite
his answer on your own**: show the error, explain in one line, and ask again. Two
attempts of yours without `OK` is a sign that the fix is not yours — stop and ask.

**If you stop without `OK`, say so in so many words to the user.** The file is already written, and the
gates will read it anyway: none of them runs the validator. A rejected configuration does not stay inert
— it protects less than it appears to, and the `intocaveis` the owner asked for may not be in force.
Until `OK` comes out, the project has incomplete protection, and he needs to know that now.

## Step 7b — emit this project's agents

**Run the three generators (7b, 7c and 7d) from inside the absolute root of Step 0, in the same command** —
`( cd -- '<raiz>' && node … )` in bash, `Push-Location -LiteralPath '<raiz>' -ErrorAction Stop; try { node … } finally { Pop-Location }` in PowerShell. They
do not receive the root: they read `projeto.json` and write to the current folder, and the current folder can silently
revert between one command and another. Measured: outside the root, they say *"rode /sworn:init primeiro"* right
after init wrote; inside another project already configured, they propose writing **into it**. Before
writing, check that the proposal's `Destino seria:` starts with the root.

The rungs from question 6 are already written. Now they become files in `.claude/agents/`.

**1. Find out what the template asks, and for which rungs:**

    node "${CLAUDE_PLUGIN_ROOT}/scripts/gerar-agentes.js" --fatias

**2. Fill in the slices for each rung**, with `AskUserQuestion` where there is a real choice. The `nome` and
the `apelido` are **not asked again**: they come from `projeto.json`. The `escalaPara` neither: the generator
fills it from the order of the ladder (the rung above; on the last one, whoever decides), and an answer of yours for that
slice is ignored.

| Slice | What to ask |
|---|---|
| `quando` | *"In what situation should this agent be called, and in which should it not?"* |
| `papel` | What it does, in two or three lines |
| `decideSozinho` | What it resolves without asking — and where it stops |
| `naoFaz` | What it does **not** do, said now so it doesn't become a broken promise |
| `esforco` | *"How much reasoning does this agent spend?"* — `low`, `medium`, `high`, `xhigh` or `max`. It is an axis **independent of the model**: when in doubt, go down, because without declaring it the agent inherits the default and a search agent pays for deep reasoning to run `grep` |
| `ferramentas` | Only the ones the role needs, separated by commas (`Read, Grep`). An agent that only reads does not get a write tool |
| `maxTurns` | How many turns it may take before stopping and handing back — an integer from 1 up |

**An agent that edits by exact text matching does not stay on the cheapest rung.** An edit that fails
becomes an escalation, and an escalation costs the whole task again: the price difference between the rungs
does not pay for a single rework. When filling in `esforco` and `ferramentas`, this decides which rung whoever
has `Edit` lands on.

The three values have their own format, and the generator refuses (`RECUSADO`, stating the accepted value) whatever
departs from it — the file only reaches the person's folder with all three valid.

**3. Write the answers to a temporary JSON**, with one key per agent name, and generate the proposal:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/gerar-agentes.js" --respostas <arquivo.json>

**4. Show the owner the whole agents** — the text that appeared on screen, not the summary.

**5. Ask for the decision in 3 options**, the recommended one first: save as is · adjust and
generate again · don't save (the project stays without agents and the cost gate gives no opinion).

**6. Only after the OK:**

    node "${CLAUDE_PLUGIN_ROOT}/scripts/gerar-agentes.js" --respostas <arquivo.json> --gravar

Paste the output. **An agent that already exists is skipped, never overwritten** — the file is someone's work,
and replacing it is the owner's decision. If the output says `PULADOS` non-zero, **say which ones** to the
user: he needs to know that those rungs keep the old content.

**7. Delete the temporary JSON** and say that the agents only appear after `/reload-plugins` or
after reopening the session.

## Step 7c — this project's skill

`regras.md` is reinjected in **every** session and so has to stay short. What is long — the rite,
the own gates, the validated decisions — goes into a **project skill**, which loads on
demand and costs nothing when it is not called.

**In a re-init with the project skill already written, skip this step and tell the owner:** the script does not
write over it (item 6), and what is missing from the `decisoes` slice follows the path of Step 4b.

**1. Find out what the template asks:**

    node "${CLAUDE_PLUGIN_ROOT}/scripts/gerar-skill.js" --fatias

**2. Fill in each slice**, with `AskUserQuestion` where there is a real choice:

| Slice | What to ask |
|---|---|
| `nome`, `slug` | The project name and the lowercase hyphenated identifier |
| `dataGeracao` | Today's date |
| `portoes` | *"What verification does this project demand that no other would?"* — contract, visual gate, ratchet, suite by area |
| `intocaveis` | What must not be touched **besides** what is already in `projeto.json` — and why |
| `decisoes` | Decisions already validated, in the form "don't ask again", with the date — and **where each thing is recorded** (the `ondeRegistrar` slice of the execution skill): use the answer from **Step 4b**, **without asking again** — the record of the owner's decisions, the still-open questions and the progress record of the plan in execution (the ledger), **one file for each** |
| `naoPromete` | What this project **does not** guarantee, said now so it doesn't become a broken promise |

**Hard rule when filling in:** never pin a version, flag, price, model name or event name. If you
need to point to a command, point to the **`projeto.json` field** that holds it. The validator
refuses, and it is right.

**3. Write the answers** to a temporary JSON and generate the proposal:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/gerar-skill.js" --respostas <arquivo.json>

**4. Show the owner the whole skill** — not the summary, the full text that appeared on screen.

**5. Ask for the decision in 3 options**, the recommended one first:

- **Save as is** — becomes this project's skill and takes effect in the next sessions.
- **Adjust first** — he points out what to change, you regenerate and show it again.
- **Don't save** — the project keeps only `projeto.json` and `regras.md`; the gates stay the same, but the
  Step 4b answer is not saved anywhere.

**6. Only after the OK:**

    node "${CLAUDE_PLUGIN_ROOT}/scripts/gerar-skill.js" --respostas <arquivo.json> --gravar

Paste the output. **The script refuses to overwrite a skill that already exists** — replacing it is the owner's decision.

**7. Delete the temporary JSON** and say that the skill only appears after `/reload-plugins` or
after reopening the session.

## Step 7d — the `AGENTS.md` that travels

Part of what was configured here needs to go along with the project outside this tool. That is what
`AGENTS.md` does — and **only that**: it is a summary, not a second source of truth.

**1. Find out what the template asks:**

    node "${CLAUDE_PLUGIN_ROOT}/scripts/gerar-agents-md.js" --fatias

**2. Fill in the slices**, with `AskUserQuestion` where there is a real choice. There are few of them on
purpose: the rest of the file **points to `projeto.json`** instead of copying it, so it doesn't
rot when the project changes.

**3. Generate the proposal and show the owner the whole file:**

    node "${CLAUDE_PLUGIN_ROOT}/scripts/gerar-agents-md.js" --respostas <arquivo.json>

**4. Ask for the decision in 3 options** and only write after the OK, with `--gravar`.

**5. Delete the temporary answers JSON**, whether or not the owner ordered it written.

**If the project already has an `AGENTS.md`, the generator refuses and touches nothing.** That is not an error:
that file may be months of work. Tell the owner that one exists, **show the proposal anyway**,
and leave the merge to him — never join the two on your own.

**If the project keeps `AGENTS.md` and `CLAUDE.md` mirrored**, a change to one of the two goes to the
other **in the same change set** — the rule and the reason are in `05-governanca.md` §2 and §3 of the `padrao`
skill, and are not repeated here. After generating or merging `AGENTS.md`, check `CLAUDE.md`
before calling the step closed.

## Step 7e — check the model catalog, because this is an installation

**Installing is the natural moment to check** whether the aliases from question 6 are still what the
vendor offers: the moment is caused by the owner himself, with no calendar and no warning every session.
That is why this step runs on **every** init, including a re-init, and the `instalacao` reason **ignores the
frequency window** — a good lookup from yesterday does not excuse this one.

**1. Ask the module, from inside the absolute root of Step 0**, as with the generators: the script reads and
writes in the current folder.

    node "${CLAUDE_PLUGIN_ROOT}/scripts/catalogo.js" --motivo instalacao

The answer carries `"sim": true` — which is what a deliberate reason means.

**2. Look it up as Step 1b of `/sworn:audit` dictates, from item 2 to 5** — read
`${CLAUDE_PLUGIN_ROOT}/skills/audit/SKILL.md`. In short: the vendor's official page first,
result shown as cited evidence, the page beats your memory, and with no network, degraded mode.

**3. Record the outcome through this command, never through `Write`** — `ok`, `semRede` or `falhou`,
followed by the sources you read, each one in single quotes:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/catalogo.js" --registrar ok '<fonte>'

`Write` to `.claude/sworn/catalogo.json` is **denied by the scope gate that Step 7 just
switched on** — the same trap that put Step 6 before 7. The file is plugin state, and the one who
writes it is its module. The output says where it wrote: check that it is the root.

**4. Nothing the lookup brings goes into `projeto.json` on your own.** A saved alias that
no longer appears on the page goes to the owner in 3 options — and the swap, if he chooses it, is a new answer
to question 6, not an edit of yours.

**5. Tell the owner that updating the plugin does not repeat this check.** No event tells the plugin
that it was updated, and the plugin guide (`GUIA.md`) declares this as a limit. After updating, it is
`/sworn:audit` that does the same lookup.

## Step 7f — the plugin's automatic update

The `sworn` marketplace is third-party: Claude Code installs it with automatic update
**off**, and without it the user stays on the version they installed. This step runs on every init, including
a re-init, and writes outside the project (in the user's Claude Code `settings.json`), so it does not go
through the scope of Step 0b.

**1. Check before asking:**

    node "${CLAUDE_PLUGIN_ROOT}/scripts/ligar-atualizacao.js"

Without `--gravar` the command writes nothing. `JA LIGADA` → say so in one line and move on to Step 8,
without asking. `ERRO` → paste the output, tell the user what it asks for and move on without turning it on. `PROPOSTA` → 
item 2.

**2. Ask through `AskUserQuestion`, in 3 options**, first saying that the new version arrives a few
minutes after the session opens and takes effect from the next session: **turn on now (recommended)** —
receives the fixes without doing anything; **no, I'll update by hand** — show the two commands under "To
update by hand" in the plugin guide (`GUIA.md`); **not now** — the next init asks again.

**3. Only with a yes**, run the same command with `--gravar` and paste the output:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/ligar-atualizacao.js" --gravar

`LIGADA` is the proof. Do not write the key through `Write` or `Edit`: the command reads the file first,
refuses what it doesn't understand without rewriting over it, and preserves the rest of the settings.

## Step 8 — close by saying what was switched on

**If in the re-init you added lines to the `escopo.md` (or to the front file) of another task
(Step 0b), remove them now**, after the last `Write` in `.claude/sworn/`, and say that you removed them.
**If `.claude/sworn/escopo.md` did not exist and init created it, remove the whole file**,
also after the last `Write`, and tell the owner that you removed it: left behind, it starts restricting the `padrao` gear
for the next task. Deleting a file is a command, not `Write`/`Edit`; use
`rm .claude/sworn/escopo.md` (in PowerShell, `Remove-Item .claude\sworn\escopo.md`), **without `-f`,
`-r` or `-Force`** — the destructive gate blocks those options, and a plain `rm` of one file goes through (measured
with `classificar` from `scripts/lib/destrutivo.js`). If the gate blocks it anyway, do not insist and do not
empty the file (an empty file still exists): tell the owner the path and ask him to delete it.

Finish with a short table: which lock stayed on, what it blocks, and how to turn it off
(`travas.<nome>: false` in `projeto.json`). The number in parentheses is what appears in the message
when the gate denies. **Warn that it is not unique:** `destrutivo` and `outraFrente` both print
"trava 5", and what tells one from the other is the text of the message — "comando destrutivo" versus "outra
frente de trabalho".

| Lock | What it blocks | How to turn off |
|---|---|---|
| `fecho` | Closing the turn claiming success without pasting evidence ("trava 3") | `travas.fecho: false` |
| `escopo` | Writing outside the scope declared in `.claude/sworn/escopo.md` ("trava 4") | **no switch** — see below |
| `destrutivo` | A destructive command **and** a loose `cd` in Bash or PowerShell ("trava 5"; the key turns both off together) | `travas.destrutivo: false` |
| `outraFrente` | Writing to a file that was already modified when the session opened, **and** that is not in the declared scope ("trava 5") | `travas.outraFrente: false` |
| *cost routing* | Dispatching an agent from the **expensive half** of the ladder on work whose declared scope only touches paths of `rapida` gear | **not a lock** — leave `agentes.escada` with fewer than two names |

**`escopo.md` does not come out of this command.** It is written per task, in `.claude/sworn/escopo.md`,
saying what is inside and what is outside that work — and the gate itself teaches its shape
the first time it denies. Say so, otherwise the `escopo` row of the table cites a file the user
has never seen and does not know how to create.

**With more than one front of work active in the same project**, each can have its own
file in `.claude/sworn/escopos/<frente>.md` (same format as `escopo.md`). Editing that file
binds the session to that front; without a binding, the general `escopo.md` stays in force.

**The last row is not a lock, and say so.** There is no `travas.custo`: the cost gate goes quiet
on its own when the ladder has fewer than two names. And it does not block only the top agent — it blocks
the upper half of the ladder, rounded up. On a ladder of five, the last two; on one of
four, also the last two. Say at which position the cut starts **on the ladder he just
answered**, otherwise he finds out at the first denied dispatch.

**Say it out loud, don't leave it only in the table:** the key `travas.escopo` exists in `projeto.json` and the
validator requires it to be there, but **no gate reads it** — putting `false` in it turns nothing
off. That is on purpose, and the reason is this: the `intocaveis` check lives inside the same gate and
runs before the gear, so a key that turned that gate off would turn off the protection of the
secrets along with it. A switch that connects to nothing is exactly the lie this plugin exists to stop —
so it is declared here, and not hidden.

Also say that **turning a lock off never becomes a free pass**: with `outraFrente` off, the file
still goes through the scope gate — what goes away is that specific denial, not the gate.

And, if the scan said the project is not in a git repository, repeat it here: `outraFrente` is
saved as on and has no way of firing in this project.

**If you configured a different folder from the one the user is working in, say this:** the
gates look at the folder where the agent's session was opened, not the one that was just configured. The
locks in this table apply when he is working **inside** this root; opening the session
elsewhere, none of them fires. Promising four locks on without this caveat is announcing
protection that will not happen.

Also say what `sworn` **does not** promise — it does not judge whether the interface came out beautiful, does not
solve concurrent sessions in the general case, and does not learn on its own.

**Close with the next commands**, one sentence each, no question, so he knows when each one applies:

- `/sworn:review` — blind review of what was written, before calling it done;
- `/sworn:reference` — studies the leaders of the same type and writes the reference the review uses
  (if he declined in Step 4b, say he can run it later);
- `/sworn:radar` — public projects similar to what he is building; it offers itself
  when the request is for a new function or improvement;
- `/sworn:shortcuts` — the deliberate simplification debt, before a release;
- `/sworn:audit` and `/sworn:calibrate` — after a few weeks: the weight of the rules and the
  chat-switch threshold.
