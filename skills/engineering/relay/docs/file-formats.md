# File formats

Everything relay writes is plain markdown. If the CLI vanished tomorrow the
protocol would still work — you would just have to maintain the index yourself.

```
.relay/
├── PROJECT.md      yours; relay never rewrites it
├── tasks.md        the authoritative tracker
├── history.md      GENERATED — never edit by hand
├── config.json     claim TTL, drift threshold, gates, tracker aliases
└── history/
    ├── 0001_relay_bootstrap.md     only when relay was adopted into existing work
    ├── 0002_cursor_intake.md
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

**Why the sequence is in the filename.** Several agents in several tools write
to the same history. Numbering per agent (`cursor_03`, `warp_01`) would say
nothing about which came first, and a separate index would be one more file to
keep in sync. With one global sequence in the filename, ordering is a property
of the filesystem. `ls` is enough.

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
git_head: 3f9a1c07be21     # written by `relay log` in a git repository
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
| `git_head` | no | The commit the work was based on. Fallback reference for counting unlogged commits. |
| `compact` | no | `true` on a compaction summary. With it: `round`, `logs` (how many it replaced), `period`, and `recover_from` (the commit that still holds them, when there is one). |
| `bootstrap` | no | `git` or `code`; marks the adoption bootstrap entry. |

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

### The bootstrap entry

When `relay init` adopts an existing project it writes
`0001_relay_bootstrap.md` with `agent: relay`, `status: partial` and a
`bootstrap:` field. Its body opens with **Facts collected at adoption** —
gathered mechanically from git or the working tree — followed by sections for
the adopting agent: what the project is, where it stands, half-done work, known
broken or risky, sources relied on, next.

It is one of two history entries meant to be completed in place rather than
superseded: the agent fills in the sections, replaces the placeholder
`summary:` and `next:`, and sets `status: done`. See [setup.md](setup.md).

### The compaction summary

`relay compact` drafts `NNNN_relay_compact.md`; `relay compact --finish`
replaces every earlier entry with it and renames it `0001_relay_compact.md`.
It opens with **What is true now**, kept short because every arriving agent
reads it, followed by the record — what was built, decisions and why, what is
still open or risky, what moved to `PROJECT.md` — and then **Facts collected at
compaction**, including a table of every log it replaced. See
[cli.md](cli.md#relay-compact).

---

## `tasks.md`

```
- [ ] `slug` — TODO
- [~] `slug` — IN_PROGRESS — claude — 2026-09-17T13:56:12Z — seen 2026-09-17T14:31:40Z — expires 2026-09-17T15:31:40Z
- [!] `slug` — BLOCKED — human must add the OAuth redirect URI
- [x] `slug` — DONE — 0007
```

| State | Box | Trailing fields |
| --- | --- | --- |
| `TODO` | `[ ]` | — |
| `IN_PROGRESS` | `[~]` | agent, claim time, `seen` (last renewal, optional), expiry |
| `BLOCKED` | `[!]` | reason |
| `DONE` | `[x]` | log sequence |

Separator is an em dash (`—`); `--` is also accepted.

**Order is priority.** `relay status` names the first `TODO` from the top of
the file as the next task, so the file order is the plan. The template's
`Now` / `Next` / `Later` headings are priority buckets; phases work too.

Indented lines under a task are free-form notes and are preserved across
rewrites. Lines inside fenced code blocks are ignored, so `tasks.md` can
document its own format without those examples registering as real tasks.

Prefer `relay claim` / `relay block` / `relay done` over hand-editing: they set
timestamps and expiry, and refuse to steal a live claim.

### Claim expiry

Every claim carries a TTL — one hour by default, from
`config.json:claimTtlHours` — and the holder renews it by re-running
`relay claim` (or `relay log`) as it works. Each renewal writes a `seen` time.

This exists because agents die mid-task constantly: credits run out, laptops
close, processes crash — and a dying agent gets no chance to say so. Without
expiry, a dead agent's claim blocks the task forever. A short TTL plus renewal
makes the claim itself the signal: renewed means alive, stale means gone, and
`relay status` and `relay doctor` say so plainly.

Expiry does not auto-release the task. It marks it takeable, and `--force`
records that a takeover happened. A live claim can also be forced when the user
asks another agent to continue the task.

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
  "claimTtlHours": 1,
  "unloggedCommitsWarn": 5,
  "gates": [],
  "trackerAliases": ["todo.md", "build_plan.md", "DEV_READY.md"]
}
```

`trackerAliases` is the list `doctor` warns about if it finds them at the
project root — competing trackers with no declared precedence are one of the
failure modes relay is designed to prevent.
