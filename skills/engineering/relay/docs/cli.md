# CLI reference

Every command is safe to run repeatedly. Nothing in relay commits, pushes,
deploys, or touches the network.

All commands except `init` require a `.relay/` directory in the current
directory or a parent.

---

## `relay init`

Create `.relay/` and the harness pointer files, adapting to whether the project
is new or already exists.

| Flag | Default | Description |
| --- | --- | --- |
| `--harness <a,b>` | `generic` | Comma-separated harness ids (see `relay harness`) |
| `--all` | — | Wire every known harness |
| `--name <name>` | directory name | Project name used in generated headings |
| `--mode <m>` | detected | `new`, `git`, or `code` — override detection |
| `--force` | — | Overwrite relay-owned files that already exist |

```bash
relay init --harness claude-code,cursor,codex
relay init --all
relay init --mode code       # existing code whose git history you want ignored
```

### Modes

| Mode | Detected when | What `init` adds |
| --- | --- | --- |
| `new` | No files beyond dotfiles, README, LICENSE and agent instruction files | Templates only; history stays empty |
| `git` | Existing files and at least two commits touching this directory | `history/0001_relay_bootstrap.md`, facts from the git log |
| `code` | Existing files, but no git or a single commit | `history/0001_relay_bootstrap.md`, facts from the working tree |

Dependencies and build output (`node_modules/`, `dist/`, `target/`, …) never
count as existing work. A single-commit repository counts as `code`, because
that is usually a scaffold or code committed in one go — the code, not the log,
is what the adopting agent has to read.

The bootstrap entry holds facts only: dates, contributors, recent commits, the
most-changed files, manifests and scripts, CI and deploy config, docs, a
`CHANGELOG` timeline. Its `summary:` and `next:` are placeholders, and
`relay doctor` fails with `bootstrap-incomplete` until an agent finishes setup
with the user — see [setup.md](setup.md).

No bootstrap is written when `.relay/` already existed — re-running `init` to
add a harness never starts generating history. Pass `--mode` to force one onto
a project set up with an older relay.

### Existing files

Relay-owned files (`.relay/*`, `.cursor/rules/relay.mdc`, …) are **left alone**
unless `--force` is passed, so re-running `init` never clobbers your
`PROJECT.md`.

Shared files that other tools and you also write — `AGENTS.md`, `CLAUDE.md`,
`WARP.md`, `GEMINI.md`, `CONVENTIONS.md` — get a block between
`<!-- relay:start -->` and `<!-- relay:end -->` appended instead. Your content
is never touched, and re-running `init` replaces the block rather than adding a
second one.

---

## `relay status`

What is going on, and what to pick up next. This is the command an arriving
agent runs first.

```bash
relay status
```

Prints task counts; how many commits of real work have landed since the last
committed log (or that commit tracking is off without git); a warning if setup
is unfinished; live claims with when each holder was last active, marking
expired ones; blocked tasks with their reasons; the most recent handoff
including its `next:` line; and the next unblocked task with the exact command
to claim it.

---

## `relay claim <task>`

Take ownership of exactly one task, or renew a claim you already hold.

| Flag | Default | Description |
| --- | --- | --- |
| `--agent <name>` | **required** | Your harness name, lowercase |
| `--ttl <hours>` | `config.claimTtlHours` (1) | Claim expiry |
| `--force` | — | Take over someone else's claim |

```bash
relay claim api-pagination --agent claude
relay claim api-pagination --agent claude          # again, later: renews
relay claim api-pagination --agent cursor --force  # takeover
```

**Renewal.** Re-running `claim` on your own live claim renews it: the line in
`tasks.md` gains a `seen` time and a fresh expiry. `relay log` renews it too.
Claims are short (one hour by default) and renewed as work continues, so a
claim that stops being renewed means its agent has almost certainly stopped.

**Someone else's live claim** is refused, with evidence to show the user: when
the holder was last active, any logs it wrote since claiming, and its likely
leftover work — uncommitted changes in a git repository, or files modified
since the claim without one. relay cannot tell a crashed agent from one still
working in another window, so the decision is the user's.

**`--force`** takes the claim over, expired or not, and prints who held it and
the same leftover-work list. Use it when the claim has expired or when the user
asked you to continue that task. Afterwards, inspect that work — `git status`
and `git diff`, or the listed files — because the previous agent may have left
work but no log, and record the takeover in your log.

`claim` never reopens a `DONE` task, with or without `--force`; add a new task
instead.

---

## `relay block <task>`

Mark a task blocked and release the claim.

| Flag | Description |
| --- | --- |
| `--reason "…"` | **required** — exactly what is needed, and by whom |

```bash
relay block staging-oauth --reason "human must add the redirect URI in the console"
```

Write the reason for someone who lacks all your context. "blocked on OAuth" is
useless six hours later; "human must add
`https://staging.example.com/api/auth/callback/google` as an Authorized redirect
URI on client 1051…" is actionable.

---

## `relay log`

Create the next sequenced history entry and regenerate the index.

| Flag | Default | Description |
| --- | --- | --- |
| `--agent <name>` | **required** | Your harness name |
| `--task <slug>` | **required** | The task this covers |
| `--status <s>` | `done` | `done`, `partial`, or `blocked` |
| `--summary "…"` | placeholder | One line: what changed |
| `--next "…"` | placeholder | One line: the single next action |
| `--session <id>` | — | Distinguish concurrent sessions of one tool |

```bash
relay log --agent claude --task staging-deploy \
  --summary "Staging on its own Neon branch and queue; prod untouched." \
  --next "Run one full tailoring job on staging to reproduce the work-item race."
```

Creates `.relay/history/NNNN_<agent>_<task>.md` from a template, then runs
`relay index`. Open the file and fill in the body — the template sections exist
because each one has cost somebody a rediscovery.

In a git repository the entry records `git_head`, the commit the work was based
on. If you hold a claim on the task, logging renews it.

If you omit `--summary`/`--next`, placeholders are written and `relay doctor`
will fail until you replace them. That is intentional.

---

## `relay done <task>`

Mark a task complete, citing the history entry that proves it.

| Flag | Default | Description |
| --- | --- | --- |
| `--log <seq>` | most recent log for this task | Sequence number to cite |

```bash
relay done staging-deploy
relay done staging-deploy --log 7
```

Refuses if no history entry references the task. You cannot mark work done
without leaving a record of it.

---

## `relay index`

Regenerate `.relay/history.md` from the front-matter of every file in
`.relay/history/`.

```bash
relay index
```

Run after editing a log's front-matter by hand. `relay log` does this for you.

---

## `relay doctor`

Verify the whole handoff surface. **Run before every handoff.**

| Flag | Description |
| --- | --- |
| `--strict` | Treat warnings as failures too |

```bash
relay doctor
relay doctor --strict    # for CI
```

Exit code `0` when clean, `1` when there are errors (or warnings under
`--strict`), so it drops straight into CI or a pre-commit hook.

### Checks

| Code | Level | What it means |
| --- | --- | --- |
| `missing-file` | error | `PROJECT.md` or `tasks.md` is absent |
| `index-stale` | error | `history.md` does not match `history/` — run `relay index` |
| `unreadable-log` | error | A file in `history/` does not match `NNNN_agent_task.md`, so it is invisible to every future agent |
| `duplicate-seq` | error | Two logs share a sequence number — concurrent writes |
| `seq-gap` | warn | A sequence number is missing, usually a deleted log |
| `incomplete-frontmatter` | error | A required field is missing |
| `placeholder-left` | error | A template `summary:` or `next:` was never filled in |
| `bootstrap-incomplete` | error | relay was adopted into an existing project but setup was never finished |
| `compact-incomplete` | error | A compaction was started and its summary not written |
| `project-unfilled` | warn | `PROJECT.md` is still the template |
| `placeholder-task` | warn | `tasks.md` still has the template task `first-task` |
| `seq-mismatch` | error | Front-matter `seq` disagrees with the filename |
| `claim-no-ttl` | warn | A claim was hand-written without an expiry |
| `claim-expired` | error | A claim outlived the agent that made it |
| `done-no-log` | warn | A `DONE` task cites no history entry |
| `done-bad-log` | error | A `DONE` task cites a log that does not exist |
| `competing-tracker` | warn | Another tracker file exists at the project root |
| `unlogged-commits` | warn | `unloggedCommitsWarn` or more commits of real work since the last committed log |
| `possible-secret` | error | Something credential-shaped is in `.relay/` |

### How unlogged commits are counted

The reference point is the newest commit that included a file in
`.relay/history/` — not the `git_head` inside the log, because logs are written
before the commit that carries the work, and that commit would otherwise always
count. Commits that only touch `.relay/` are bookkeeping and never count. If
`.relay/` is never committed, the newest log's `git_head` is used instead.

---

## `relay compact`

Fold a finished round of work into one summary entry, so history does not grow
forever. Agents run it only when the user agrees — usually when `relay status`
reports that every task is done.

| Flag | Description |
| --- | --- |
| *(none)* | Draft the summary as the newest entry |
| `--finish` | Replace the round's logs with the completed summary |
| `--confirm-delete` | With `--finish`: allow it when git cannot restore the deleted logs |

```bash
relay compact                            # 1. draft
# ... an agent writes the summary with the user ...
relay compact --finish                   # 2. replace
```

**Drafting** writes `NNNN_relay_compact.md` with what the CLI can collect: how
many logs, the dates, which agents, every log's `summary` and `next`, the tasks
done and those carried over. The narrative — *What is true now*, *What was
built*, *Decisions and why*, *Still open or risky*, *Moved to PROJECT.md* — is
left for the agent. `doctor` reports `compact-incomplete` until it is written.

It refuses while an agent holds a live claim, or while any log still has a
placeholder `summary` or `next`. Open tasks are fine; they carry over.

**Finishing** refuses until `summary`, `next` and *What is true now* are
written. Then it deletes the round's logs, renames the summary to
`0001_relay_compact.md`, removes `DONE` tasks from `tasks.md`, and regenerates
the index. The next log is `0002`.

If every deleted log is committed and unchanged, the summary records
`recover_from:` — the commit that still holds them. Otherwise the deletion is
permanent, and `--finish` refuses without `--confirm-delete`.

A later compaction replaces the previous summary too; the draft points at it so
the agent carries forward what is still true.

---

## `relay harness [id...]`

List known harnesses, or add pointer files for more.

```bash
relay harness              # list all, with files and confidence levels
relay harness zed cline    # add pointers for these
```

---

## `relay version` · `relay help`

```bash
relay version
relay help
```

---

## Configuration

`.relay/config.json`:

```json
{
  "claimTtlHours": 1,
  "unloggedCommitsWarn": 5,
  "gates": [],
  "trackerAliases": ["todo.md", "build_plan.md", "DEV_READY.md"]
}
```

| Key | Description |
| --- | --- |
| `claimTtlHours` | How long a claim lasts without renewal. Agents renew by re-running `relay claim`; raise this if your agents cannot renew often. |
| `unloggedCommitsWarn` | Commits of unlogged work before `doctor` warns. |
| `gates` | Commands agents should run before marking work done. Documented in `PROJECT.md`; relay never runs them. |
| `trackerAliases` | Filenames `doctor` flags as competing trackers if found at the project root. |
