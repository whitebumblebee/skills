# relay

**Hand work between AI coding agents without losing context.**

You start a feature in Claude Code. Credits run out. You continue in Cursor.
Cursor has no idea what happened — so it re-reads the codebase, re-derives the
same conclusions, makes a decision the previous agent already rejected for a
good reason, and quietly breaks something. Two days later you switch to Codex
and pay for all of it again.

relay is a small protocol plus a CLI that fixes this. It gives every project a
`.relay/` directory that any agent, in any tool, can read in sixty seconds to
know exactly where things stand — and a discipline for leaving it that way.

```bash
npx skills@latest add whitebumblee/skills@relay
node .agents/skills/relay/bin/relay.mjs init --all
```

---

## The problem this actually solves

Most "agent handoff" setups are a `todo.md` and a folder of history files. That
works for about two weeks. Then:

- **Ordering is lost.** `history_cursor_28.md` and `history_warp_02.md` — which
  came first? The filenames only sequence *within* one agent. Global order
  lives in a hand-written index.
- **The index rots.** Because it is maintained by hand, it drifts. In the two
  projects relay was extracted from, one index was missing 1 of 49 entries; the
  other was missing **18 of 22**. The artifact a new agent needs most was the
  first to become unreliable.
- **Claims never expire.** An agent claims a task, runs out of credits, and
  vanishes. The claim sits there for weeks. Every later agent either blocks on
  it forever or takes it unsafely.
- **Trackers multiply.** `todo.md`, `build_plan.md`, `plan_high.md`,
  `project-handoff.md`, `DEV_READY.md` — five documents, no declared
  precedence, and the newest agent guesses wrong.
- **The rules get copied per harness.** `CLAUDE.md`, `AGENTS.md`, `WARP.md`,
  `.cursor/rules/`, `.kiro/steering/` each hold a full copy that drifts apart.
- **Nothing is checkable.** No command tells you the handoff surface is broken,
  so you find out when an agent acts on stale information.

relay's answer to all six is structural, not motivational.

## How it works

**Ordering lives in the filename.** Logs are `0001_cursor_intake.md`,
`0002_warp_migrations.md`, `0003_claude_deploy.md` — a single global sequence
across every agent and every tool. `ls` alone tells you the order.

**The index is generated.** `.relay/history.md` is built from the front-matter
of the log files by `relay index`. Hand-editing it is pointless, and drift
becomes impossible rather than merely discouraged.

**Claims expire.** `relay claim` stamps a TTL. `relay doctor` reports claims
that outlived the agent holding them, and `--force` documents the takeover.

**One tracker.** `.relay/tasks.md` is authoritative. Plans are subordinate to
it, and `doctor` warns when a competing tracker appears at the project root.

**One copy of the rules.** Each harness gets a short pointer file. The protocol
lives in `.relay/` only.

**`relay doctor` verifies all of it** in one command, and exits non-zero — so it
works in CI or as a pre-handoff gate.

## Quick start

Install the skill. The CLI ships inside it — there is nothing to `npm install`
and no registry involved.

```bash
cd your-project
npx skills@latest add whitebumblee/skills@relay
```

That lands the skill at `.agents/skills/relay/`, symlinked into `.claude/skills/`,
`.cursor/skills/` and every other agent directory in your project. Then:

```bash
node .agents/skills/relay/bin/relay.mjs init --harness claude-code,cursor,codex
```

The rest of this document writes that as plain `relay`. To get the short form
for yourself, add an alias once:

```bash
alias relay="node $PWD/.agents/skills/relay/bin/relay.mjs"
```

Agents do not need the alias — `SKILL.md` tells them the full path.

`init` creates:

```
.relay/
  PROJECT.md      invariants, gates, what needs a human   (yours to fill in)
  tasks.md        the authoritative tracker
  history.md      generated index — never edit by hand
  history/        0001_agent_task.md, 0002_...
  config.json     claim TTL, gates, tracker aliases
CLAUDE.md         ┐
AGENTS.md         ├ short pointer files — one per harness
.cursor/rules/    ┘
```

Fill in `PROJECT.md` and put real work in `tasks.md`. Then any agent, in any
tool, runs:

```bash
relay status
```

## The loop an agent follows

```bash
relay status                                   # what is going on, what is next
relay claim api-pagination --agent claude      # take exactly one task
# ... do the work, run the project's gates ...
relay log --agent claude --task api-pagination # create the next sequenced log
# ... fill in summary, outcomes, risks, and `next:` ...
relay done api-pagination                      # cites the log automatically
relay doctor                                   # must pass before handing off
```

Blocked instead of finished:

```bash
relay block api-pagination --reason "needs the OAuth redirect URI added in console"
```

## What a handoff log looks like

```markdown
---
seq: 7
agent: claude
date: 2026-09-17T14:03:00Z
task: staging-deploy
status: done
summary: Deployed staging on its own Neon branch and queue; prod untouched.
next: Run one full tailoring job on staging to reproduce the work-item race.
supersedes: []
---

# staging-deploy

## What I did
...
## Commands run and their outcomes
npx vitest run -> 178 passed / 3 skipped
...
## Risks, warnings, and what is NOT done
...
```

`summary` and `next` are required. `relay doctor` fails if the template
placeholders are left in, because a log that does not say what comes next costs
the following agent a full context rebuild to reach a conclusion its author
already had.

## Works with your tools

Verified conventions for Claude Code, Cursor, Codex, Warp, Kiro, Cline, Kilo
Code, Roo, Windsurf, Gemini CLI and Aider; AGENTS.md — the closest thing to a
cross-tool standard — for opencode, Zed, Antigravity, Command Code, T3 Code, Pi
and anything else.

```bash
relay harness              # list them all, with the files each one reads
relay harness zed cline    # add pointers for more later
```

See [docs/harnesses.md](docs/harnesses.md) for per-tool setup.

## Migrating an existing project

If you already have `history_<agent>_<NN>.md` files, relay can renumber them
into a single global sequence, recovering order from your old index, then from
dates inside the files, then from mtime — telling you which is which.

```bash
relay migrate --from .            # dry run; prints the full mapping
relay migrate --from . --apply    # after you have read it
```

**Read the dry run before applying.** Order recovered from mtime is a guess and
only you can confirm it. Nothing is deleted. Full guide:
[docs/migration.md](docs/migration.md).

## Documentation

| | |
| --- | --- |
| [Getting started](docs/getting-started.md) | Install, first project, the daily loop |
| [Harnesses](docs/harnesses.md) | Setup for every supported tool |
| [CLI reference](docs/cli.md) | Every command, every flag |
| [File formats](docs/file-formats.md) | Front-matter schema, task states, naming |
| [Migration](docs/migration.md) | Moving an existing project onto relay |
| [Design notes](docs/design.md) | Why it works this way |

## Requirements

Node 18+. No dependencies — relay runs inside whatever sandbox an agent happens
to have, where `npm install` is not always available.

It is not published to npm. The CLI travels inside the skill, so installing the
skill installs the tool, and an agent that can read `.agents/skills/` can run it
even with no network access.

## License

MIT. This skill lives in [whitebumblee/skills](https://github.com/whitebumblee/skills).
