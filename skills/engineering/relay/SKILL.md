---
name: relay
description: Continue work another AI agent started, and leave work another agent can continue. Use when asked to set up or add relay to a project, new or existing; at the start of any session on a project containing a .relay/ directory; when deciding what to work on next; when asked to continue or pick up another agent's work; when handing off because context or credits are running out; and before marking any task complete. Covers project setup interviews, task claiming, handoff logs, the generated history index, and cross-harness continuity between tools such as Claude Code, Cursor, Codex, Warp, Kiro, Cline and opencode.
---

# relay

This project is worked on by several AI agents, in different tools, with
separate context windows and separate credit limits. You are one of them.

**Chat transcripts are not shared memory. `.relay/` is.** Anything you learn
that is not written there is lost the moment your session ends.

## Running relay

relay is a Node CLI that ships inside this skill. Use the first that works:

1. `relay` — if it is on `PATH`
2. `node .agents/skills/relay/bin/relay.mjs` — project install
3. `node ~/.agents/skills/relay/bin/relay.mjs` — global install

This document writes every command as plain `relay`. If none resolve, follow
the same rules by editing the `.relay/` files by hand — never skip the protocol
because the CLI is missing.

## Start of session

1. If there is no `.relay/`, or `relay status` says setup is not finished,
   **finish setup before any other work** — follow [setup.md](docs/setup.md).
2. Read `.relay/PROJECT.md`, `.relay/tasks.md` and `.relay/history.md`; then
   "What is true now" in `0001_relay_compact.md` if it exists; then the newest
   logs relevant to your task.
3. Run `relay status`. It names the next unblocked task.
4. Inspect the actual repository. History records what was true when it was
   written; if it disagrees with the code, the code wins, and you say so in
   your log.

## Claim before you edit

```bash
relay claim <task> --agent <your-harness-name>
```

One task, one owner. Re-run the same command between major steps to renew it;
claims expire after an hour.

**Take someone else's claim only if it is EXPIRED, or the user asked you to
continue that task.** Otherwise show the user the evidence `relay claim` prints
and ask. After any takeover, inspect the leftover work before editing. Full
rules: [takeover.md](docs/takeover.md).

Stay inside the claimed task. Anything you notice outside it becomes a new task
with a priority the user chooses — see [new-work.md](docs/new-work.md).

## While working

- Never write secret values anywhere: history, task notes, terminal summaries,
  screenshots, test fixtures. Use IDs, URLs and names instead.
- Do not commit, push, deploy, delete cloud resources, rotate secrets, or spend
  money unless the user asked for that specific action.
- Never mark something done on the strength of reading the code. Run the gates
  in `.relay/PROJECT.md`.
- History is append-only. If an earlier log was wrong, write a new one with
  `supersedes: [<seq>]`. Never hand-edit `history.md`; `relay index` generates
  it.

## Ending your session — the part that matters

Do this **before** you run out of context or credits, not after.

```bash
relay log --agent <you> --task <task>
```

Fill in the created file:

- **What you did** — files changed, and the decisions behind them
- **Commands and exact outcomes** — `178 passed / 3 skipped`, not "tests pass"
- **External resources touched** — IDs, URLs, revisions; never credentials
- **Risks and what is NOT done** — anything the next agent would be burned by
- **`next:`** — the single next action, concrete enough to act on. Mandatory;
  `relay doctor` fails on the placeholder.

Then:

```bash
relay done <task>     # cites your log
relay doctor          # must pass before the handoff is complete
```

Blocked instead, or need the human? `relay block <task> --reason "…"`, and see
[blocked.md](docs/blocked.md).

When `relay status` says every task is done, **ask the user whether to compact
the round** — never compact without asking. Steps: [compaction.md](docs/compaction.md).

## Precedence

When sources disagree: the user's newest instruction, then `PROJECT.md`, then
`tasks.md`, then the code and deployed state, then history.

## Reference

Open these only when you need them:

| When | Read |
| --- | --- |
| Setting relay up, or setup is unfinished | [setup.md](docs/setup.md) |
| A task you want is claimed by someone else | [takeover.md](docs/takeover.md) |
| You found work outside your task | [new-work.md](docs/new-work.md) |
| You are blocked, or the next step needs the human | [blocked.md](docs/blocked.md) |
| Every task is done, or the user asks to compact | [compaction.md](docs/compaction.md) |
| Any command's flags | [cli.md](docs/cli.md) |
| Log and task formats | [file-formats.md](docs/file-formats.md) |
| A specific tool's setup | [harnesses.md](docs/harnesses.md) |

No relay command commits, pushes, deploys, or touches the network.
