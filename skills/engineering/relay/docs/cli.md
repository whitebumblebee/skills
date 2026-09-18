# CLI reference

Every command is safe to run repeatedly. Nothing in relay commits, pushes,
deploys, or touches the network.

All commands except `init` and `migrate` require a `.relay/` directory in the
current directory or a parent.

---

## `relay init`

Create `.relay/` and the harness pointer files.

| Flag | Default | Description |
| --- | --- | --- |
| `--harness <a,b>` | `generic` | Comma-separated harness ids (see `relay harness`) |
| `--all` | — | Wire every known harness |
| `--name <name>` | directory name | Project name used in generated headings |
| `--force` | — | Overwrite files that already exist |

```bash
relay init --harness claude-code,cursor,codex
relay init --all
```

Existing files are **left alone** unless `--force` is passed, so re-running
`init` to add a harness never clobbers your `PROJECT.md`.

---

## `relay status`

What is going on, and what to pick up next. This is the command an arriving
agent runs first.

```bash
relay status
```

Prints task counts, live claims (marking expired ones), blocked tasks with their
reasons, the most recent handoff including its `next:` line, and the next
unblocked task with the exact command to claim it.

---

## `relay claim <task>`

Take ownership of exactly one task.

| Flag | Default | Description |
| --- | --- | --- |
| `--agent <name>` | **required** | Your harness name, lowercase |
| `--ttl <hours>` | `config.claimTtlHours` (4) | Claim expiry |
| `--force` | — | Take over an existing claim |

```bash
relay claim api-pagination --agent claude
relay claim api-pagination --agent cursor --ttl 8
```

Refuses to steal a live claim. If the claim has expired, `--force` takes it over
and prints who held it — record that takeover in your log.

Also refuses to reopen a `DONE` task; add a new task instead.

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

Run after editing a log's front-matter by hand. `relay log` and
`relay migrate --apply` do this for you.

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
| `seq-mismatch` | error | Front-matter `seq` disagrees with the filename |
| `claim-no-ttl` | warn | A claim was hand-written without an expiry |
| `claim-expired` | error | A claim outlived the agent that made it |
| `done-no-log` | warn | A `DONE` task cites no history entry |
| `done-bad-log` | error | A `DONE` task cites a log that does not exist |
| `competing-tracker` | warn | Another tracker file exists at the project root |
| `possible-secret` | error | Something credential-shaped is in `.relay/` |

---

## `relay migrate`

Convert legacy `history_<agent>_<NN>.md` files into a single global sequence.

| Flag | Default | Description |
| --- | --- | --- |
| `--from <dir>` | `.` | Directory holding the legacy files |
| `--apply` | — | Perform it; **dry run without this** |

```bash
relay migrate --from .skillframework
relay migrate --from .skillframework --apply
```

Prints the full mapping and labels how each file's date was recovered — from
your old index, from the file's contents, or from mtime. Verify anything marked
`mtime (guess)` before trusting the order. Originals are never deleted.

See [migration.md](migration.md).

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
  "claimTtlHours": 4,
  "gates": [],
  "trackerAliases": ["todo.md", "build_plan.md", "DEV_READY.md"]
}
```

| Key | Description |
| --- | --- |
| `claimTtlHours` | Default claim expiry. Raise it for long-running tasks, lower it for fast-moving projects with many agents. |
| `gates` | Commands agents should run before marking work done. Documented in `PROJECT.md`; relay never runs them. |
| `trackerAliases` | Filenames `doctor` flags as competing trackers if found at the project root. |
