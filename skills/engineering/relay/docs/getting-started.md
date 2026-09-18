# Getting started

## Install

relay needs Node 18+ and has no dependencies. It is distributed as an agent
skill, not an npm package — the CLI ships inside the skill directory.

```bash
cd your-project
npx skills@latest add whitebumblee/skills@relay
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

```bash
relay init --harness claude-code,cursor,codex
```

Pick the tools you actually use, or `--all`. You can add more later with
`relay harness <id>`.

### Fill in `PROJECT.md`

This is the highest-leverage thing you will do. It is read by every agent, in
every tool, at the start of every session.

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

Keep it short enough that it actually gets read. A page is plenty.

### Put real work in `tasks.md`

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

Do the work. Run the gates from `PROJECT.md`. Then, **before you run low on
context or credits** — not after:

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

## Working in parallel

Two agents can work at once if each holds a distinct task and their file scopes
do not overlap. relay does not lock anything — it makes collisions *visible*
(`relay doctor` reports duplicate sequence numbers) rather than preventing them,
which is the right tradeoff for a system where agents die unpredictably.

## Adding relay to CI

```yaml
- run: npx skills@latest add whitebumblee/skills@relay
- run: node .agents/skills/relay/bin/relay.mjs doctor --strict
```

If `.agents/skills/relay/` is committed to the repo, the first step is
unnecessary — run the second on its own.

This catches a stale index, unfilled placeholders, expired claims and
credential-shaped strings before they reach anyone else.

## Next

- [CLI reference](cli.md) — every command and flag
- [File formats](file-formats.md) — front-matter schema and task states
- [Harnesses](harnesses.md) — per-tool setup
- [Migration](migration.md) — bringing an existing project onto relay
