---
name: relay
description: Continue work another AI agent started, and leave work another agent can continue. Use when asked to set up or add relay to a project, new or existing; at the start of any session on a project containing a .relay/ directory; when deciding what to work on next; when asked to continue or pick up another agent's work; when handing off because context or credits are running out; and before marking any task complete. Covers project setup interviews, task claiming, handoff logs, the generated history index, and cross-harness continuity between tools such as Claude Code, Cursor, Codex, Warp, Kiro, Cline and opencode.
---

# relay

This project is worked on by several AI agents, in different tools, with
separate context windows and separate credit limits. You are one of them.

**Chat transcripts are not shared memory. `.relay/` is.** Anything you learn
that is not written there is lost the moment your session ends — and the next
agent will pay to rediscover it.

## Running relay

relay is a zero-dependency Node CLI that ships inside this skill. Resolve it
once, at the start of your session, in this order — use the first that works:

1. `relay` — if it is already on `PATH`
2. `node .agents/skills/relay/bin/relay.mjs` — project install
3. `node ~/.agents/skills/relay/bin/relay.mjs` — global install

Confirm with `<that command> version`. This document writes every command as
plain `relay`; substitute whichever form resolved.

If none resolve, **follow the protocol below by hand** — the files are plain
markdown, logs are `.relay/history/NNNN_<agent>_<task>.md` on a four-digit
global sequence, and you keep `.relay/history.md` in sync yourself. Never skip
the protocol because the CLI is missing.

## Setting up relay

Setup is unfinished when there is no `.relay/` yet, or when
`.relay/history/0001_relay_bootstrap.md` still has `TODO:` in `summary:` or
`next:` (`relay status` says so). Finish it before any other work:

1. `relay init --harness <the tools this project uses>`. It detects the mode —
   **new** (empty project), **git** (existing work with git history), or
   **code** (existing work, no git history) — and prints which.
2. Read `docs/setup.md`, next to this file, and follow the section for that
   mode. It is an interview: gather what the project can tell you first, then
   ask the user only what it cannot. **Every suggestion you make — CI,
   deployment, payments, anything — comes with a priority question**, and
   `tasks.md` is ordered by the answers.

## Start of session

Read, in this order:

1. `.relay/PROJECT.md` — architecture, invariants, gates, what needs the human
2. `.relay/tasks.md` — the authoritative tracker
3. `.relay/history.md` — generated index of every prior session
4. The newest `.relay/history/NNNN_*.md` entries relevant to your task

Then run `relay status`, which summarises all of it and names the next
unblocked task.

Then **inspect the actual repository** — code, tests, migrations, running
processes, deployed state. History records what was true when it was written.
It never overrides what is true now. If they disagree, the repository wins and
you say so in your log.

## Claim before you edit

```bash
relay claim <task> --agent <your-harness-name>
```

One task, one owner. Do not touch a task someone else holds.

Claims expire after an hour, because agents die mid-task — credits run out,
laptops close, processes crash. **Re-run the same `relay claim` between major
steps** (after each test run, say) to renew yours; `relay log` renews it too.
A claim that stops being renewed is how everyone else learns you are gone.

### Taking over someone else's task

Take a claim held by another agent with `--force` only when:

- `relay status` shows it EXPIRED, or
- **the user asked you to continue or pick up that task** — that is a
  reassignment, so do not ask them again.

Otherwise `relay claim` refuses and prints evidence: when the holder was last
active, its logs since claiming, and its likely leftover work. Show that to the user and
ask. Never take a live claim on your own judgement — a crashed agent and one
still working in another window look identical in the files.

After any takeover, assume the previous agent left work but no log. `relay
claim` lists where to look: uncommitted changes with git, or files modified
since the claim without it. **Inspect them before editing** — `git status` and
`git diff`, or read the listed files — decide what to keep, and record the
takeover and what you found in your log.

Work inside the claimed task. Scope creep is how two agents collide.

### Work you discover along the way

A bug you noticed, a refactor, a missing feature, anything you would suggest —
if it is outside your claimed task, it becomes a new task, not something you
do now:

1. Check *Deferred and declined* in `.relay/PROJECT.md` first. Never re-suggest
   what the user already postponed or turned down.
2. **Ask the user where it goes: now, next, later, or not needed.** Batch
   several findings into one question. Add it to `tasks.md` as a `TODO` at
   that position; record "later" and "not needed" under *Deferred and
   declined* with the reason.
3. If you cannot ask, add it at the bottom of `tasks.md` with the note
   `priority not confirmed`, and list it in your log.

Do it inside your current task only if it blocks that task, and say so in
your log.

If `relay status` finds no available task, tell the user and ask what comes
next. New work you propose follows the same rule.

## While working

- Never write secret values anywhere: not in history, task notes, terminal
  summaries, screenshots, or test fixtures. Use IDs, URLs and names instead.
- Do not commit, push, deploy, delete cloud resources, rotate secrets, or spend
  money unless the user asked for that specific action.
- Validate in proportion to risk. Never mark something complete on the strength
  of reading the code. Run the gates in `.relay/PROJECT.md`.
- If you discover that a previous log was wrong, do not edit it. Write a new
  entry and set `supersedes: [<seq>]`. History is append-only; that is what
  makes it trustworthy.

## Ending your session — the part that matters

Do this **before** you run out of context or credits, not after. A session that
ends without a log has produced nothing another agent can build on, however
much code it wrote.

```bash
relay log --agent <you> --task <task>
```

That creates the next sequenced entry and regenerates the index. Fill it in:

- **What you did** — files added, modified, deleted, and the decisions behind them
- **Commands and exact outcomes** — `178 passed / 3 skipped`, not "tests pass".
  Record failures too, including ones you did not cause
- **External resources touched** — IDs, URLs, revisions, queue names; no credentials
- **Risks and what is NOT done** — anything the next agent would be burned by
- **`next:`** — the single action that comes next, concrete enough to act on

`next:` is mandatory and `relay doctor` fails if you leave the placeholder. A
log that does not say what comes next costs the following agent a full context
rebuild to reach a conclusion you already had.

Then:

```bash
relay done <task>     # cites your log automatically
relay doctor          # must pass before you consider the handoff complete
```

If you are blocked rather than finished:

```bash
relay block <task> --reason "exactly what is needed, and by whom"
```

Keep the task open and record the blocker type, the exact non-secret error,
what you already tried, and whether retrying is safe.

## When the human has to do it

Some things an agent cannot or must not do alone: OAuth consent screens,
billing, DNS, account verification, product judgement, anything irreversible.

Consolidate these into **one numbered message**. For each item give the exact
URL or path, the exact values that are safe to share, and how you will verify it
afterwards. Mark the task `BLOCKED`, keep dependents blocked, and do not mark it
done until the human confirms. Then record their confirmation in your log.

## Precedence

When sources disagree:

1. The user's newest explicit instruction
2. `.relay/PROJECT.md`
3. `.relay/tasks.md`
4. The current code, tests and deployed state
5. `.relay/history.md` and the logs, as historical record

Plans and design documents are subordinate to `tasks.md`.

## Do not hand-edit

`.relay/history.md` is generated from the front-matter of the files in
`.relay/history/`. Hand-editing it is pointless — the next `relay index`
overwrites it — and a hand-maintained index is exactly what rotted in the
framework relay replaced, until most entries were missing from it.

Change the log file, then run `relay index`.

## Commands

| | |
| --- | --- |
| `relay status` | Where things stand; the next unblocked task |
| `relay init` | Set up relay; detects new / git / code mode |
| `relay claim <t> --agent <a>` | Claim one task, or renew your own (`--force` to take over — see above) |
| `relay block <t> --reason "…"` | Mark blocked with what is needed |
| `relay log --agent <a> --task <t>` | Create the next history entry |
| `relay done <t>` | Mark done, citing your log |
| `relay index` | Regenerate `history.md` |
| `relay doctor` | Verify everything; run before every handoff |

Every flag is in `docs/cli.md`, next to this file. `relay help` prints the same
summary. No relay command commits, pushes, deploys, or touches the network.
