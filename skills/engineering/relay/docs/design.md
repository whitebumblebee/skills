# Design notes

Why relay works the way it does.

The starting point: coding agents are good at continuing work from a clear
written note, and bad at knowing where that note is, whether it is current, or
whether another agent is already doing the same thing. Every decision below is
about making the note reliable without asking agents for extra discipline —
because the moment a session ends unexpectedly, discipline is exactly what goes
missing.

---

## Decision 1 — order lives in the filename

Logs are named `0001_cursor_intake.md`, `0002_warp_migrations.md`: one global
sequence across every agent and every tool.

The obvious alternatives are worse. Numbering per agent (`cursor_01`,
`warp_01`) says nothing about which came first. Keeping order in a separate
index means the index becomes the one file everyone must remember to update.
With the sequence in the filename, `ls` answers "what happened, in what order",
and there is nothing to keep in sync.

The cost is that two agents logging at the same moment can collide on a
number. `doctor` reports it as `duplicate-seq` and the fix is a rename — a
cheap, visible failure, and far better than a lock in a system where agents
stop unpredictably.

## Decision 2 — the index is generated, never written

`history.md` gives a one-screen summary of every session. It is built from the
front-matter of the log files, never edited by hand.

The general principle: **never store important information in the artifact
that requires the most discipline to maintain.** Derive it from the files that
get written anyway. An agent whose session dies mid-task still left its log;
the index catches up the next time anyone runs `relay index` or `relay log`.

## Decision 3 — claims expire, and are renewed

Agents stop without warning — credits run out, laptops close, processes crash
— and a stopping agent gets no chance to release what it held. A claim that
never expires would block its task forever.

So claims are short and renewed as work continues. A claim that stops being
renewed is how everyone else learns its agent is gone. Expiry does not release
the task silently; it marks it takeable, and a takeover is recorded.

A live claim can still be taken over when the user asks another agent to
continue that task. Files cannot tell a crashed agent from one still working
in another window — the user can.

## Decision 4 — exactly one tracker

Projects accumulate plans, roadmaps and to-do files. Each is useful, and each
partly describes what to do next. An arriving agent cannot tell which one is
current.

relay declares `tasks.md` authoritative, and `PROJECT.md` states the order of
precedence explicitly. Plans still hold reasoning that does not fit in a task
list; they are just not the source of truth for what is happening. `doctor`
warns when another tracker appears at the root.

## Decision 5 — one copy of the rules, a pointer per tool

Every tool reads its own file: `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`,
`.kiro/steering/`. Giving each a full copy of the rules produces copies that
drift apart.

relay writes a short pointer per tool — where to look, how to run the CLI, and
the handful of rules that matter most — and keeps the protocol in `.relay/`.
In files the user already owns, the pointer is a marked block, so their own
content is never touched.

## Decision 6 — `next:` is mandatory

The most expensive handoff is one that describes what happened but not what to
do. The next agent has to rebuild enough context to reach a conclusion its
predecessor already had, and pays full token cost to get there.

Every log carries a one-line `next:`, and `doctor` fails on the unfilled
placeholder.

## Decision 7 — history is append-only

Corrections are new entries with `supersedes: [n]`, never edits.

An editable history is a current-beliefs document with a misleading name. The
value of a log is that it records what was believed at the time, which is what
lets a later agent recognise that an assumption was wrong.

## Decision 8 — existing projects start with facts, not a blank page

A project adopting relay usually has months of work behind it. An empty history
would tell arriving agents nothing — while the instructions tell them to read
history first.

So `relay init` writes a first entry from what it can collect mechanically:
the git log, or the working tree if there is no git. Everything that needs
judgment — where the project stands, what is half-done, what comes next — is
left for an agent to write with the user, and `doctor` fails until it is done.

## Decision 9 — `doctor` exists at all

Everything above is enforceable in principle by careful agents. In practice,
sessions end mid-task, instructions get skimmed, and files get edited by hand.

A protocol that cannot be verified degrades invisibly. One that can degrades
visibly, and visible problems get fixed. `doctor` exits non-zero so it works in
CI and as a pre-handoff gate.

## Decision 10 — no dependencies

relay runs inside whatever sandbox a coding agent has. Several run with no
network access; some cannot `npm install` at all. Node 18 and the standard
library are the safe assumption.

This is why the YAML front-matter parser is a small hand-written subset rather
than a library. The grammar is deliberately limited — `key: scalar` and
`key: [a, b]` — because it is written by language models and read by a tool,
and a small predictable grammar serves both.

## Decision 11 — `.relay/` is committed

It is tempting to treat agent working files as scratch and gitignore them.
That is the wrong trade. Committing means context survives a change of
machine, teammates' agents get the same briefing yours do, and the reasons
behind the code live next to the code. `doctor` scans for credential shapes to
make that safe.

---

## What relay deliberately does not do

- **No locking.** Agents stop too unpredictably for locks to be safe. relay
  makes collisions visible instead.
- **No task decomposition.** That is the model's job, not the protocol's.
- **No gate execution.** `PROJECT.md` declares the gates; relay never runs
  them. A tool that runs arbitrary commands from a config file is a liability.
- **No network.** Nothing in relay phones home, fetches, or publishes.
- **No harness integration.** Pointer files only. Integrations break when tools
  change; files do not.
