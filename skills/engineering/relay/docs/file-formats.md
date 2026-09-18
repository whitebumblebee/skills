# File formats

Everything relay writes is plain markdown. If the CLI vanished tomorrow the
protocol would still work — you would just have to maintain the index yourself.

```
.relay/
├── PROJECT.md      yours; relay never rewrites it
├── tasks.md        the authoritative tracker
├── history.md      GENERATED — never edit by hand
├── config.json     claim TTL, gates, tracker aliases
└── history/
    ├── 0001_cursor_intake.md
    ├── 0002_warp_migrations.md
    └── 0003_claude_staging-deploy.md
```

---

## History filenames

```
NNNN_<agent>_<task>.md
0003_claude_staging-deploy.md
```

| Part | Rule |
| --- | --- |
| `NNNN` | Four-digit **global** sequence, across every agent and tool. Zero-padded so `ls` sorts correctly. |
| `<agent>` | Lowercase harness name, kebab-case. Be consistent — `claude`, not `Claude` one day and `claude-code` the next. |
| `<task>` | The task slug from `tasks.md`, kebab-case. |

**Why the sequence is in the filename.** This is the core fix relay makes over
the `history_<agent>_<NN>.md` convention it replaces. Per-agent numbering tells
you nothing about global order: given `history_cursor_28.md` and
`history_warp_02.md`, you cannot say which came first without consulting an
index — and that index is hand-maintained, so it drifts. Putting the sequence in
the filename makes ordering a property of the filesystem. `ls` is enough.

---

## History front-matter

```yaml
---
seq: 7
agent: claude
session: claude-b          # optional
date: 2026-09-17T14:03:00Z
task: staging-deploy
status: done               # done | partial | blocked
summary: Deployed staging on its own Neon branch and queue; prod untouched.
next: Run one full tailoring job on staging to reproduce the work-item race.
supersedes: []
migrated_from: history_claude_01.md   # only on migrated logs
---
```

| Field | Required | Notes |
| --- | --- | --- |
| `seq` | yes | Must match the filename. `doctor` reports a mismatch. |
| `agent` | yes | Lowercase harness name. |
| `session` | no | Distinguishes concurrent sessions of one tool. |
| `date` | yes | ISO 8601 UTC. |
| `task` | yes | Slug from `tasks.md`. |
| `status` | yes | `done`, `partial`, `blocked`. |
| `summary` | yes | One line. Becomes the index row. |
| `next` | yes | One line. The single next action. |
| `supersedes` | no | Sequence numbers this entry corrects. |

The parser accepts a small YAML subset — `key: scalar` and `key: [a, b]`. That
is deliberate: front-matter is written by agents and read by a tool, and a small
grammar is predictable for both. Anything richer belongs in the body.

### Why `next` is mandatory

A handoff log that does not say what comes next is the most expensive kind. The
next agent has to rebuild enough context to re-derive a conclusion its author
already had — and pays full token cost to arrive where the last session ended.
`relay doctor` fails on the unfilled placeholder for exactly this reason.

Write it as an action, not a topic. Not *"continue the migration"* but
*"migrate POST /api/items to the cursor encoder in `lib/paginate.ts:82`."*

### Corrections

History is append-only. If you discover an earlier log was wrong, do not edit
it — write a new entry and list the sequence it corrects:

```yaml
supersedes: [4]
```

The index collects these under **Superseded**. Editing history in place destroys
the only property that makes it trustworthy: that it records what was believed
at the time.

---

## History body

The template exists because each section has cost somebody a rediscovery:

```markdown
## What I did
Files added, modified, deleted. Decisions and why.

## Commands run and their outcomes
Exact commands, exact results. "178 passed / 3 skipped", not "tests pass".
Record failures too, including ones you did not cause.

## External resources touched
IDs, URLs, revisions, queue names. Never credentials.

## Risks, warnings, and what is NOT done
Anything the next agent would be burned by. Unverified assumptions go here,
not in the summary.

## Next
The `next:` field, with enough detail to act on.
```

The most valuable section is usually the fourth. Work that looks finished but
rests on an unverified assumption is how agents mislead each other.

---

## `tasks.md`

```
- [ ] `slug` — TODO
- [~] `slug` — IN_PROGRESS — claude — 2026-09-17T13:56:12Z — expires 2026-09-17T17:56:12Z
- [!] `slug` — BLOCKED — human must add the OAuth redirect URI
- [x] `slug` — DONE — 0007
```

| State | Box | Trailing fields |
| --- | --- | --- |
| `TODO` | `[ ]` | — |
| `IN_PROGRESS` | `[~]` | agent, claim time, expiry |
| `BLOCKED` | `[!]` | reason |
| `DONE` | `[x]` | log sequence |

Separator is an em dash (`—`); `--` is also accepted.

Indented lines under a task are free-form notes and are preserved across
rewrites. Lines inside fenced code blocks are ignored, so `tasks.md` can
document its own format without those examples registering as real tasks.

Prefer `relay claim` / `relay block` / `relay done` over hand-editing: they set
timestamps and expiry, and refuse to steal a live claim.

### Claim expiry

Every claim carries a TTL — four hours by default, from
`config.json:claimTtlHours`.

This exists because agents die mid-task constantly: credits run out, laptops
close, processes crash. Without expiry, a dead agent's claim blocks the task
forever, and the next agent either waits indefinitely or takes it with no way to
know whether that is safe. With expiry, `relay status` and `relay doctor` say
plainly that the holder is gone.

Expiry does not auto-release the task. It marks it takeable, and `--force`
records that a takeover happened.

---

## `history.md` — generated

Derived from the front-matter of every file in `history/`. It carries a
`DO NOT EDIT` banner because hand-editing is pointless — the next `relay index`
overwrites it.

Unreadable files are listed in their own section rather than silently dropped,
so a badly named log is visible instead of invisible.

---

## `PROJECT.md`

Yours. relay creates it once and never touches it again. See
[getting-started](getting-started.md#fill-in-projectmd).

---

## `config.json`

```json
{
  "claimTtlHours": 4,
  "gates": [],
  "trackerAliases": ["todo.md", "build_plan.md", "DEV_READY.md"]
}
```

`trackerAliases` is the list `doctor` warns about if it finds them at the
project root — competing trackers with no declared precedence are one of the
failure modes relay is designed to prevent.
