# Getting started

## Install

relay needs Node 18+ and has no dependencies. It is distributed as an agent
skill, not an npm package — the CLI ships inside the skill directory.

```bash
cd your-project
npx skills@latest add whitebumblebee/skills@relay
```

This copies the skill to `.agents/skills/relay/` and symlinks it into every
agent directory it finds (`.claude/skills/`, `.cursor/skills/`, …). Add
`--global` to install to `~/.agents/skills/` for every project instead.

### Running the CLI

```bash
node .agents/skills/relay/bin/relay.mjs status
```

The docs write that as plain `relay`. For the short form, alias it once per
shell:

```bash
alias relay="node $PWD/.agents/skills/relay/bin/relay.mjs"
```

Or symlink it onto your `PATH`:

```bash
ln -s "$PWD/.agents/skills/relay/bin/relay.mjs" /usr/local/bin/relay
```

Agents need neither — `SKILL.md` tells them the path to invoke.

Because the CLI travels with the skill, it works inside sandboxes with no
network access at all, which several coding agents run in.

## Set up a project

The easiest way: tell your agent **"set up relay for this project."** The skill
takes it from there. You can also start it yourself:

```bash
relay init --harness claude-code,cursor,codex
```

Pick the tools you actually use, or `--all`. You can add more later with
`relay harness <id>`.

`init` works out which of three situations you are in:

| Your project | What happens |
| --- | --- |
| **Empty** — nothing built yet | Your agent interviews you: what you are building, for whom, the MVP, the stack. It suggests things like CI and deployment, asks where each belongs in the order, and turns your answers into `PROJECT.md` and a prioritised `tasks.md`. |
| **Existing, with git history** | relay writes a bootstrap history entry from the git log. Your agent reads it, the code and the docs, tells you what it understood, asks about what the history cannot say — and what you want to build next. |
| **Existing, without git** | Your agent reads and understands the code first, forms its own view, then asks only what stayed unclear, plus what enhancements you want. It writes the same bootstrap entry from what it found. |

Whatever the agent suggests — CI/CD, staging, payments, monitoring — it asks
whether you want it **now, next, later, or not at all**, and orders
`tasks.md` by your answers. "Later" and "not at all" are recorded in
`PROJECT.md` with your reason, so no agent suggests them again.

If you already have an `AGENTS.md` or `CLAUDE.md`, relay adds a clearly marked
section to it and leaves your content alone.

In existing projects, setup is not finished until the agent completes the
bootstrap entry with you — `relay status` says so, and `relay doctor` fails
until then. The agent's procedure is in [setup.md](setup.md).

### What goes in `PROJECT.md`

Whether you or an agent writes it, this is the highest-leverage file in relay.
It is read by every agent, in every tool, at the start of every session.

Put in it what you would otherwise have to say twice:

- **Architecture you must not break.** Not a tour of the codebase — the
  invariants that are expensive to rediscover. *"AI calls are server-only."*
  *"Every query filters by the authenticated user id."* *"Migrations are
  additive; never restructure a column in place."*
- **Environments**, and which one is dangerous.
- **Validation gates** — the exact commands to run before calling anything done.
- **What needs a human.** Committing, pushing, deploying, spending money,
  console-only work. Be explicit; agents will otherwise either do it or ask
  about it every time.
- **Deferred and declined.** What you chose to do later or not at all, and why.

Keep it short enough that it actually gets read. A page is plenty.

### What goes in `tasks.md`

Agents pick the first `TODO` from the top, so **order is priority**.

```markdown
## Now

- [ ] `api-pagination` — TODO
  - Cursor-based pagination on /api/items. Existing offset version is O(n) at page 400.

- [ ] `fix-session-refresh` — TODO

## Next

- [ ] `bundle-audit` — TODO
```

Slugs should be short, stable, and specific. They end up in filenames.

### Commit it

`.relay/` is meant to be committed. It is how context survives not just a change
of agent but a change of machine, and how your teammates' agents get the same
briefing yours do.

If your history logs contain things you would rather not publish, `relay doctor`
scans for credential shapes — but review before making a repo public.

## The daily loop

Whatever tool you are in:

```bash
relay status
```

That prints where things stand and names the next unblocked task. Then:

```bash
relay claim api-pagination --agent claude
```

Claims last an hour; the agent re-runs the same `claim` between major steps to
renew it. Do the work. Run the gates from `PROJECT.md`. Then, **before you run
low on context or credits** — not after:

```bash
relay log --agent claude --task api-pagination
```

Open the created file and fill it in. Then:

```bash
relay done api-pagination
relay doctor
```

`doctor` must pass. If it does not, you have left the next agent something
broken.

## Switching tools mid-task

This is the case relay is built for, and there is no special procedure — that is
the point.

In the old tool, before you run out:

```bash
relay log --agent claude --task api-pagination --status partial \
  --summary "Cursor pagination on the read path; writes not migrated yet." \
  --next "Migrate POST /api/items to the cursor encoder in lib/paginate.ts:82."
relay block api-pagination --reason "handing off: context exhausted"
```

In the new tool:

```bash
relay status
relay claim api-pagination --agent cursor
```

The new agent reads the log, sees exactly where the previous one stopped and
what comes next, and continues. No archaeology.

### When the old tool died without a handoff

Credits often run out mid-sentence, with no chance to log. The task is still
claimed, and the claim has not expired yet. Tell the new agent to **continue
that task** — asking it to is the reassignment, so it takes the claim over
with `--force` without asking you again:

```bash
relay claim api-pagination --agent cursor --force
```

relay lists where the old agent's half-done work probably is — uncommitted
changes with git, files modified since its claim without git. The new agent
inspects them, decides what to keep, and records the takeover in its log.

If you have not said anything, an agent that finds a live claim will not take
it on its own. It shows you the evidence — when the holder was last active,
any logs, its likely leftover work — and asks.

## Work discovered along the way

When an agent notices something outside its task — a bug, a refactor, a
feature it would suggest — it does not do it on the spot. It asks you **now,
next, later, or not needed**, and adds a task at that position in `tasks.md`.
"Later" and "not needed" are recorded in `PROJECT.md` so it is never suggested
again. If it cannot ask, it adds the task at the bottom marked
`priority not confirmed` and mentions it in its log. The same happens when
every task is done and the agent proposes what comes next.

## Finishing a round: compaction

History grows by one file per session. When every task in `tasks.md` is done,
the agent asks whether to compact the round. Say yes and it drafts one summary
with `relay compact`, writes it with you, and runs `relay compact --finish`.
The round's logs are replaced by `0001_relay_compact.md`, finished tasks are
cleared, and the next round starts from that summary — the same way `relay init`
starts an existing project from a first entry.

If `.relay/` is committed, the deleted logs stay in git and the summary records
the commit. Without git, they are gone for good, and relay asks you to confirm.

## Working in parallel

Two agents can work at once if each holds a distinct task and their file scopes
do not overlap. relay does not lock anything — it makes collisions *visible*
(`relay doctor` reports duplicate sequence numbers) rather than preventing them,
which is the right tradeoff for a system where agents die unpredictably.

## Adding relay to CI

```yaml
- run: npx skills@latest add whitebumblebee/skills@relay
- run: node .agents/skills/relay/bin/relay.mjs doctor --strict
```

If `.agents/skills/relay/` is committed to the repo, the first step is
unnecessary — run the second on its own.

This catches a stale index, unfilled placeholders, expired claims, unfinished
setup, work committed without a log, and credential-shaped strings before they
reach anyone else. `unlogged-commits` needs the full history, so check out with
`fetch-depth: 0`.

## Next

- [How it works](relay_flow.md) — every scenario and handoff case, end to end
- [Setup](setup.md) — the agent's setup interview, for all three modes
- [CLI reference](cli.md) — every command and flag
- [File formats](file-formats.md) — front-matter schema and task states
- [Harnesses](harnesses.md) — per-tool setup