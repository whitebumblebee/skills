# Design notes

Why relay works the way it does. Every decision here comes from watching a
hand-rolled version of this framework succeed for about two weeks and then decay
in specific, repeatable ways across two real projects.

---

## The evidence

Two projects, both using a `history_<agent>_<NN>.md` convention with a
hand-written `history.md` index:

| | Project A | Project B |
| --- | --- | --- |
| History files | 49 | 22 |
| Missing from the index | 1 | **18** |
| Oldest unresolved `IN_PROGRESS` claim | 17 days | — |
| Competing tracker files | 2 | 6 |
| Copies of the same rules document | 5 | 3 |

Project A was actively maintained by a careful operator and still lost an entry.
Project B's index had been abandoned entirely — 82% of its history was invisible
to any agent that trusted it.

That is the whole design brief: **the protocol was sound, and it decayed anyway.**
Every fix in relay targets decay rather than ignorance.

---

## Decision 1 — ordering lives in the filename

The original convention numbered logs per agent. `history_cursor_28.md` and
`history_warp_02.md` carry no information about which came first, so global
ordering had to live somewhere else — and the only place available was the index.

relay uses one global sequence: `0028_cursor_...`, `0029_warp_...`. Ordering
becomes a property of the filesystem. `ls` answers the question. No index needs
to be trusted, no tool needs to be installed, and nothing can drift.

The cost is that two agents logging simultaneously can collide on a number.
`doctor` reports it as `duplicate-seq` and the fix is a rename. That is a cheap,
visible failure, and vastly preferable to a locking scheme in a system where
participants die unpredictably.

## Decision 2 — the index is generated, never written

This is the central change.

The old index was a hand-maintained table that was also the only source of
global ordering. It had the worst possible property combination: **maximum
importance, zero enforcement.** Every agent was asked to remember to append a
row. Agents that ran out of credits mid-task forgot. Nothing noticed.

relay stores per-entry metadata in each log's front-matter and derives
`history.md` from it. Hand-editing is pointless because the next `relay index`
overwrites it. Drift stops being a discipline problem and becomes structurally
impossible.

The general principle: **never store important information in the artifact that
requires the most discipline to maintain.** Derive it from the artifacts that get
written anyway.

## Decision 3 — claims expire

An agent claims a task and then vanishes — credits exhausted, laptop closed,
process killed. In the original framework the claim stayed `IN_PROGRESS`
forever. One sat untouched for 17 days.

That leaves the next agent with two bad options: block indefinitely on a dead
claim, or take it with no way to know whether someone is actually working.

relay stamps every claim with a TTL. Expiry does not release the task
automatically — silent release would be its own hazard — it marks it *takeable*,
and `--force` records that a takeover occurred. The information a new agent
needs is on the line itself.

## Decision 4 — exactly one tracker

Project B had six documents that all partially described what to do next, with
no declared precedence. The newest agent has no way to choose correctly.

relay declares `tasks.md` authoritative and makes everything else subordinate.
`PROJECT.md` states the precedence order explicitly, and `doctor` warns when a
competing tracker appears at the root.

Plans are still useful — they hold reasoning that does not fit in a task list.
They are just not the source of truth for what is happening.

## Decision 5 — one copy of the rules, N pointers

The natural way to support many harnesses is to give each one a rules file. That
produces N copies of the same document, which drift. Project A had five, already
divergent.

relay writes a short pointer per harness — where to look, and the handful of
rules that matter most — with the protocol living in `.relay/` only. Pointers are
stable, so they do not need updating when the protocol changes.

## Decision 6 — `next:` is mandatory

The most expensive kind of handoff log is one that describes what happened but
not what to do. The next agent must rebuild enough context to re-derive a
conclusion its predecessor already reached, and pays full token cost to arrive
where the last session ended.

relay requires a one-line `next:` and fails `doctor` on the unfilled
placeholder. It is the single highest-value line in the file.

## Decision 7 — history is append-only

Corrections are new entries with `supersedes: [n]`, never edits.

An editable history is not a record — it is a current-beliefs document with a
misleading filename. The value of a log is that it says what was believed at the
time, which is what lets a later agent recognise that an assumption was wrong.

## Decision 8 — `doctor` exists at all

Everything above is enforceable in principle by careful agents. Project A proves
careful agents are not enough: it was maintained attentively and still drifted.

A protocol that cannot be verified degrades invisibly. One that can degrades
visibly, and visible degradation gets fixed. `doctor` exits non-zero so it works
in CI and as a pre-handoff gate.

## Decision 9 — no dependencies

relay runs inside whatever sandbox a coding agent has. Several run with no
network access; some cannot `npm install` at all. Node 18 and the standard
library are the safe assumption.

This is why the YAML front-matter parser is a small hand-written subset rather
than a library. The grammar is deliberately limited — `key: scalar` and
`key: [a, b]` — because it is written by language models and read by a tool, and
a small predictable grammar serves both better than a large one.

## Decision 10 — `.relay/` is committed

The framework it replaces was gitignored, on the reasoning that agent operating
files are not product code.

That is the wrong trade. Committing means context survives a change of machine,
your teammates' agents get the same briefing yours do, and the project's
engineering history is part of the repository. `doctor` scans for credential
shapes to make that safe.

---

## What relay deliberately does not do

- **No locking.** Agents die too unpredictably for locks to be safe. relay makes
  collisions visible instead.
- **No task decomposition.** That is the model's job, not the protocol's.
- **No gate execution.** `PROJECT.md` declares the gates; relay never runs them.
  A tool that runs arbitrary commands from a config file is a liability.
- **No network.** Nothing in relay phones home, fetches, or publishes.
- **No harness integration.** Pointer files only. Integrations break when tools
  change; files do not.
