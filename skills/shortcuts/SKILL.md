---
name: shortcuts
description: Lists the repository's deliberate shortcuts - comments with the atalho: mark (or ponytail:, shortcut:) that say what was simplified, how far it holds and when to replace it - and points out those with no replacement trigger. Use when you want to know what simplification debt the code carries, before a release or when the owner asks.
---

# `/sworn:shortcuts` — what was simplified on purpose

A deliberate shortcut is good as long as someone remembers it. The "less code" block asks that every shortcut
carry a comment with three labels, and this skill gathers those comments into a single list, so the
debt is not forgotten in the middle of the code.

The comment, after `//`, `#`, `--`, `/*` or `<!--`:
`// atalho: <what was simplified>. limite: <how far it holds>. trocar quando: <trigger>.`

The labels are "limite:" and "trocar quando:", spelled exactly like this even in a project written in another
language: the script recognizes only these. The labels split the note, not commas, so a comma inside a sentence does
not break the reading. With no label at all, the whole text becomes the "what" and the shortcut comes out as
`sem-gatilho`.

The note may go on in the lines right below the mark, one label per line, in any order. A line joins when it is only
a comment and opens with a label the note does not have yet; inside an open `/*` or `<!--` block, every line up to
the close counts.

The reading stops at the first line that does not join. A label the note already has stops it with no warning: the
first value holds and that line stays out, so write each label once. A comment line with text but no label also
stops it; if the note has no final period, the list shows `sem ponto final: a linha de baixo ficou de fora` under
the shortcut. To fix it, start that line with one of the labels, or move the rest of the sentence to the line above.
A line of code, an empty comment or a comment with another mark stops it with no warning.

## Step 1 — list

    node "${CLAUDE_PLUGIN_ROOT}/scripts/atalhos.js"

Run in the repository folder. The script only reads: it scans the files git tracks and the new ones it does
not ignore (what `.gitignore` covers, `.git` and `node_modules` stay out), skips binaries and files
above 1 MB, and changes nothing. Outside a git repository it says why and exits with code 1.

The default mark is `atalho`; `ponytail` and `shortcut` also count, for those who already use them. Another mark goes
in the `marcaDeAtalho` key of `.claude/sworn/projeto.json` (one word only), and then it replaces
`atalho`.

## Step 2 — show

Show the entire output, as it came: the panel already comes grouped by file, with the line of each shortcut,
the summary and, when there is a shortcut with no trigger, the advice to write the "trocar quando:".

- **A shortcut with no trigger** is what matters to point out: with no trigger, nobody knows when to replace it. Propose
  the trigger in one line per shortcut, reading the surrounding code; **do not edit the comment** unless the owner
  asks.
- **"Nenhum atalho registrado."** does not mean code with no shortcuts: it means none was
  marked. The line below says in how many files the script searched.

## On its own, every 30 days

When a session opens, in a project with `projeto.json`, sworn shows the full list (with and without
a trigger) at most once every 30 days, with the instruction to check whether any "trocar quando" has already
happened and, if so, take it to the owner in 3 options. It scans the open folder and the repositories right
below it (a workspace that keeps its projects in separate repositories is not left out); it lists up to
10 shortcuts, and the rest is left to this skill. With no shortcut, nothing is shown. The date is kept in
`.claude/sworn/atalhos-revisao.json`; the interval changes in `limiares.diasEntreAtalhos`, and
`"atalhosNaAbertura": false` turns it off. When a shortcut shows up there, run this skill for the detail.

## What this skill does NOT do

- **Does not find a shortcut with no mark.** It reads comments, not code: a simplification without the comment does not
  appear. Finding code that did not need to exist is the review's job (`/sworn:review`).
- **Does not read a line below that has no label.** Only lines that open with `limite:` or `trocar quando:` join
  the note; a sentence broken onto the next line is left out, with the warning above.
- **Does not judge whether the shortcut still holds.** It shows the trigger; whoever checks whether it has fired is you,
  reading the code, and whoever decides to replace it is the owner.
