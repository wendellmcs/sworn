# Environment — the traps that cost a whole session

Nothing here is theory. These are failure modes that **have already consumed rounds of work**, and
all have the same signature: the command seems to have worked, and the damage shows up later.

This project's platform is in `{{campo:plataforma}}`.

---

## 1. A script goes by file, not by heredoc

**The backslash and the backtick disappear in a shell tool's heredoc.** Writing an inline script with
`<<'EOF'` silently corrupts every regex with `\d`, `\s`, `\.`, every Windows path, and every
backtick. Line breaks get lost too.

**Rule:** a probe, measurement or fix script is **written with the file-writing tool** and run by an
interpreter (`node arquivo.js`, `python arquivo.py`). Never pasted inline.

This happened twice on the same day before becoming a rule. The symptom is cruel: the script runs,
gives no error, and returns a wrong number — which is exactly the case the gauge rule in
[04-verificacao.md](04-verificacao.md) exists to catch.

**Tools called in the same turn run in parallel.** Sending or attaching a file and regenerating the
folder it comes from in the same turn fails **silently** — the send doesn't find the file, and the
question that went out together already claimed the delivery. Send in one turn, ask in the next, after
seeing the confirmation; if you need to regenerate, write to another folder and keep the original
until the send confirms.

---

## 2. Encoding in hooks and process output

**PowerShell output in a pipe is not UTF-8 by default** on a localized Windows — it comes out in the
system code page (CP850 in pt-BR), and every accent reaches the consumer as an invalid byte.

Every hook or command that prints accented text needs to force this first:

```
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
```

And, when reading a file, pass the encoding explicitly instead of trusting the default:
`Get-Content -Raw -Encoding utf8`.

**`Set-Content` and `Add-Content` write in the system ANSI page by default.** When writing a file that
another tool will read, always pass `-Encoding utf8`.

---

## 3. Executable script in pure ASCII

`.ps1`, `.bat` and `.cmd` files: **ASCII only**. An accent in an executable script is the most
annoying class of bug to diagnose, because the error shows up far from the cause and sometimes only on
one machine.

A message for humans goes in a data file (`.md`, `.json`) read by the script — not embedded in it.

---

## 4. The shell has grammar, and the command is not what it looks like

When deciding something by reading a command line (gate, filter, log):

- **an environment variable is case-insensitive** on Windows;
- a path with a space needs quotes, and a URI of a path with a space needs escaping;
- the same command has aliases, long and short forms, and introducers that change the rest of the line;
- **a command quoted inside a string is not an executed command** — `git commit -m "removi o rm -rf"`
  deletes nothing.

If the goal is to block a dangerous command, accept that the reading is approximate, **declare the
false positive** it produces, and prefer erring on the side of blocking.

**A command that lists the environment leaks secrets.** `export`, `env`, `set` and `printenv` with no
argument print every variable — including the token the environment carries — into the transcript. To
remove a variable, `unset NOME`; to pass it to one command only, `VAR=x comando`. **If it leaks, say
so in the same answer and recommend revoking the token.**

**The exit code of a piped command is the last link's.** `suite | tail -40` returns 0 with the suite
failing: the proof is the exit code of the command alone, or the summary it prints. The order of the
redirection matters too: `cmd 2>&1 > arquivo` sends the error to the terminal, and
`cmd > arquivo 2>&1` sends it to the file.

**The Git for Windows shell fails now and then before the command runs** (`fork` error, exit 5). It is
not the command's error nor a syntax error: **repeating the same command fixes it**. Rewriting it
believing the syntax is wrong is lost time.

**The `bash` on PowerShell's `PATH` may be WSL's, not Git Bash.** Proving that "bash runs this"
requires the same bash the tool uses: check that the path exists, look at the process's `error` and
`status`, and include a case that **must** run (positive control) — without it, "no case ran" looks
like a result and is just the instrument. The plugin's code already handles this
(`scripts/lib/shell.js`); here is the why.

**A Windows short path (`NOME~1`, 8.3 format) breaks whatever rejects it.** A temp or user directory
may come in that form; `import.meta.url` returns it with the tilde encoded, and deriving the script's
directory from that URL's `pathname` gives `ENOENT` at a place that exists. Agent tools also deny
reading such a path out of suspicion. **Resolve the real path** (`fs.realpathSync.native`) before
using it.

---

## 5. Git index, CRLF and the phantom file

With `core.autocrlf=true`, the index can diverge from disk with no real edit: `git status` shows a
modified file whose diff is empty.

- `git update-index --refresh` and `--really-refresh` do **not** fix it.
- `git add --renormalize .` fixes it, but **stages all the real files** — and in a tree with another
  session's work that is exactly the collision Step -1 forbids.
- **The correct way out is surgical:**

```
git add --renormalize -- <apenas os arquivos fantasma>
```

It touches the index, not the disk, and nothing gets staged.

**The writing tool and `sed -i` change the file beyond what you asked.** `sed -i` rewrites the whole
file in LF, destroying the CRLF of a CRLF file, and reads backslash-u in the substitution as
"uppercase the next character". Write and Edit **convert a typed accent escape into the real
character** (and, in a file that already uses escapes, the reverse). For a file with escapes or with
CRLF, edit by a Node script with exact `replace` and check afterward. **Count the CR with Node** (the
bytes with value 13 in the `Buffer`), before and after: `grep -c` of CR lied, giving 0 in a file with hundreds.

---

## 6. Nested repositories

A directory's `git status` **doesn't see** a nested repository that has its own `.git`. A workspace
can have three independent repos and a clean status at the root while two of them have uncommitted
work.

Run it in each repo the task touches. List the three states separately, at the start and at the
close-out.

---

## 7. Skills and configuration don't go up a directory

A `settings.json` can read a file from the parent directory by a relative path. **A skill can't.** It
is resolved in the project directory or in the user directory — and nowhere else.

Practical consequence: a reminder injected by a hook can tell you to load a skill that, in that
directory, **doesn't exist** — and the agent obeys the instruction, doesn't find the file, and goes on
without saying. A skill that must work across several projects lives in the **user directory**.

The same goes for output style.

**The `skills:` field in an agent's frontmatter injects only the body of `SKILL.md`.** The
`references/` files don't come along: an agent that depends on a rubric, value table or long checklist
still needs a reading tool. And an agent or skill created or edited now **only exists in a new
session** — the registry is read at opening, and the conversation in progress doesn't see it.

---

## 8. Proving a hook without an interactive terminal

Non-interactive mode (`-p` / print) **runs hooks normally**, including the session-open and
session-close ones. A hook can be proven by an agent, without the owner's hand.

```
( cd <pasta descartavel, fora de qualquer repositorio>
  mkdir -p <pasta de estado que o hook usa>
  claude -p "<pedido>" --plugin-dir "<caminho>" --permission-mode acceptEdits
  cat <pasta de estado>/<arquivo de contador> )
```

`--permission-mode acceptEdits` is necessary: without it the request that creates a file hangs asking
for permission and the run never reaches the close.

**The proof is the trace on disk, never the model's prose.** The model saying "the gate blocked me" is
an account; the counter written to the file is evidence. **Creating the state folder before the run**
is what turns one into the other.

---

## 9. A network that re-signs HTTPS

A corporate network with TLS inspection delivers every HTTPS signed by a root of the company itself.
The operating system trusts it; **a program that brings its own certificate list doesn't** — and the
failure looks like a network one (`Transport error`, `unable to verify the first certificate`), not a
certificate one.

**In Node, `node --use-system-ca` uses the system list**; the alternative is to point
`NODE_EXTRA_CA_CERTS` at a root `.pem`, which also serves command-line tools packaged in Node. The
variable only holds in the process where it was set: a new window loses it. Windows `curl` may fail
the revocation check with the re-signed root, and `--ssl-no-revoke` gets past it.

To confirm the cause, connect with verification turned off **only to print the chain's issuer**: if it
isn't a public authority, it is re-signing. **Turning verification off is not the fix.** And an owner
step that depends on an environment variable becomes a script that shows the state (prints that the
variable exists) before going on.
