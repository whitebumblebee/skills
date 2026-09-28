# relay

**Hand work between AI coding agents without losing context.**

You start a feature in Claude Code. Credits run out. You continue in Cursor.
Cursor has no idea what happened — so it re-reads the codebase, re-derives the
same conclusions, makes a decision the previous agent already rejected for a
good reason, and quietly breaks something. Two days later you switch to Codex
and pay for all of it again.

relay gives every project a shared memory that lives in the repository, not in
any one tool. A `.relay/` folder that any agent, in any tool, reads at the
start of a session and writes to before it stops. Plus a small CLI that keeps
that folder in order.

```bash
npx skills@latest add whitebumblebee/skills@relay
```

Then tell your agent: **"set up relay for this project."**

---

## Why agents need this

Coding agents are good at picking up work from a clear written note. What they
do not have is somewhere to find that note:

- **Every session starts from zero.** The chat that explains what happened
  lives in one tool. Switch tools, or open a new session, and it is gone.
- **Decisions get relitigated.** Without a record of *why* something was done,
  the next agent re-derives it — or undoes it.
- **Work dies mid-task.** Credits run out and the session ends, and the
  half-finished work has no explanation attached.
- **Agents collide.** Two agents running at once can pick the same task.
- **Nothing tells you it's stale.** A handoff note can be missing, outdated or
  half-written, and you find out when an agent acts on it.

## What relay gives you

A `.relay/` folder with four parts, and the rules for keeping it current:

- **`PROJECT.md` — what is true.** Architecture you must not break, the checks
  that must pass, what needs a human, what was deliberately postponed.
- **`tasks.md` — what is being done.** One list, in priority order. Each task
  has at most one owner at a time.
- **`history/` — what happened.** One short log per session, numbered in a
  single sequence across every agent and tool, each ending with the one thing
  the next agent should do.
- **`relay doctor` — proof it's intact.** One command that checks all of it.

## How it works

**Order lives in the filename.** Logs are `0001_cursor_intake.md`,
`0002_warp_migrations.md`, `0003_claude_deploy.md`. `ls` alone tells you what
happened, in order, across every tool.

**Every log ends with `next:`.** The single action the next agent should take.
It is the most valuable line in the file, so it is mandatory.

**The index is generated.** `.relay/history.md` summarises every log, and it is
built from the logs themselves, so it can never fall out of date.

**Tasks have owners.** An agent claims a task before working on it. Claims
expire unless renewed, so a task held by an agent whose session died becomes
free again. Asking an agent to continue another's task hands it over.

**It starts where your project is.** `relay init` recognises an empty project,
one with git history, and one with code but no git. For existing projects it
writes a first history entry from what it finds, and your agent interviews you
to fill in the rest.

**One set of rules, every tool.** relay adds a short section to `AGENTS.md`,
`CLAUDE.md` and each tool's rules file, pointing at `.relay/`. The rules live in
one place.

**It stays small.** When every task is done, the agent asks whether to compact
the round. `relay compact` folds its logs into one summary, which becomes the
starting point of the next round.

**It is checkable.** `relay doctor` exits non-zero when something is wrong, so
it works before a handoff and in CI.

## Quick start

Install the skill. The CLI ships inside it — there is nothing to `npm install`
and no registry involved.

```bash
cd your-project
npx skills@latest add whitebumblebee/skills@relay
```

That lands the skill at `.agents/skills/relay/`, symlinked into `.claude/skills/`,
`.cursor/skills/` and every other agent directory in your project. Then tell
your agent **"set up relay for this project"**, or run it yourself:

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
  PROJECT.md      invariants, gates, what needs a human, what was deferred
  tasks.md        the authoritative tracker, in priority order
  history.md      generated index — never edit by hand
  history/        0001_agent_task.md, 0002_...
  config.json     claim TTL, drift threshold, gates, tracker aliases
CLAUDE.md         ┐ short pointers — one per harness; appended as a marked
AGENTS.md         ├ block if you already have these files
.cursor/rules/    ┘
```

Then your agent runs the setup interview in [docs/setup.md](docs/setup.md). It
reads whatever already exists, asks you what it cannot work out, suggests things
like CI and deployment and asks how you want them prioritised, and writes
`PROJECT.md` and `tasks.md` from your answers. After that, any agent, in any
tool, runs:

```bash
relay status
```

## The loop an agent follows

```bash
relay status                                   # what is going on, what is next
relay claim api-pagination --agent claude      # take exactly one task
# ... do the work, re-running the claim between steps to renew it,
#     and run the project's gates ...
relay log --agent claude --task api-pagination # create the next sequenced log
# ... fill in summary, outcomes, risks, and `next:` ...
relay done api-pagination                      # cites the log automatically
relay doctor                                   # must pass before handing off
```

When every task is done, and you agree:

```bash
relay compact            # draft one summary of the round
relay compact --finish   # replace the round's logs with it
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

## Documentation

| | |
| --- | --- |
| [Getting started](docs/getting-started.md) | Install, first project, the daily loop |
| [How it works](docs/relay_flow.md) | Every scenario end to end: setup, picking up work, every kind of handoff |
| [Setup](docs/setup.md) | The agent's setup interview for new and existing projects |
| Agent procedures | [Takeover](docs/takeover.md), [new work](docs/new-work.md), [blocked](docs/blocked.md), [compaction](docs/compaction.md) — loaded by agents only when needed |
| [Harnesses](docs/harnesses.md) | Setup for every supported tool |
| [CLI reference](docs/cli.md) | Every command, every flag |
| [File formats](docs/file-formats.md) | Front-matter schema, task states, naming |
| [Design notes](docs/design.md) | Why it works this way |

## Requirements

Node 18+. No dependencies — relay runs inside whatever sandbox an agent happens
to have, where `npm install` is not always available.

It is not published to npm. The CLI travels inside the skill, so installing the
skill installs the tool, and an agent that can read `.agents/skills/` can run it
even with no network access.

## License

MIT. This skill lives in [whitebumblebee/skills](https://github.com/whitebumblebee/skills).
