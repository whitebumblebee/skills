# Migration

Moving an existing project from `history_<agent>_<NN>.md` onto relay.

> **Nothing here has been run on your projects.** Every command below is yours
> to execute when you are ready. `relay migrate` is a dry run unless you pass
> `--apply`, and even then it never deletes your originals.

---

## What migration has to solve

Legacy filenames sequence **within one agent only**. Given
`history_cursor_28.md` and `history_warp_02.md`, nothing in the names says which
came first. Global order lived in a hand-written index — which is exactly the
thing that drifts.

So `relay migrate` recovers order from three sources, in descending order of
trustworthiness, and tells you which it used for every file:

| Source | Label | Trust |
| --- | --- | --- |
| Your legacy index's row order | `legacy index` | High — it was written chronologically |
| A date inside the file | `file contents` | Good |
| Filesystem mtime | `mtime (guess)` | **Verify these** |

Files missing from your old index are the ones that need attention, because they
fall through to a weaker signal. relay counts them for you.

---

## Steps

### 1. Dry run

```bash
cd your-project
relay migrate --from .          # or --from .skillframework
```

This prints the complete mapping — old name, new name, date, and which source
the date came from — plus two counts at the end:

```
49 files.
1 were missing from the legacy index.
1 ordered by mtime — verify these before trusting the order.
```

### 2. Read the mapping

This is the step not to skip. Check specifically:

- **Anything labelled `mtime (guess)`.** mtime reflects when the file was last
  *touched*, which may be long after it was written. If a log was edited later,
  it will sort too late.
- **Files missing from the legacy index.** They were invisible to every agent
  that trusted the index, so their placement is the least certain.
- **The overall narrative.** Does the order match how the project actually
  progressed?

If something is misplaced, fix it after applying by renaming the file and
updating its `seq:` front-matter, then running `relay index`.

### 3. Initialise relay

```bash
relay init --harness claude-code,cursor,warp,kiro,codex
```

Do this **before** `--apply`; migration writes into `.relay/history/`. `init`
notices the legacy files and deliberately writes **no** bootstrap entry — your
migrated logs are the history, and a summary on top would only compete with
them. Your existing `AGENTS.md` and `CLAUDE.md` get a marked relay section
appended; nothing you wrote is changed.

### 4. Apply

```bash
relay migrate --from . --apply
```

Each legacy file becomes `NNNN_<agent>_<task>.md` with generated front-matter:
`seq`, `agent`, `date`, `task`, `status`, `summary` (recovered from your old
index where possible), `next`, and `migrated_from` pointing at the original
name. The body is preserved unchanged. `history.md` is regenerated.

**Your originals are not deleted.** Review the result, then remove them
yourself.

### 5. Port the tracker

Migration does not convert `todo.md` — task formats vary too much to convert
safely, and this is the file where a bad guess does real damage.

Move the live items into `.relay/tasks.md` by hand, in relay's format:

```
- [ ] `slug` — TODO
- [!] `slug` — BLOCKED — reason
- [x] `slug` — DONE — 0007
```

While you are there, **audit the stale claims**. Long-lived projects accumulate
`IN_PROGRESS` entries from agents that died weeks ago. Either re-claim them
properly (so they carry an expiry) or set them back to `TODO`.

### 6. Port the invariants

Copy the durable parts of your old `AGENTS.md` / `instructions_agents.md` into
`.relay/PROJECT.md` — or ask an agent to, following the interview in
[setup.md](setup.md) — and split them as you go:

- **Generic protocol** — claiming, logging, handoff discipline — is already in
  relay. Delete your copy.
- **Project-specific invariants** — architecture rules, gates, environments,
  what needs a human — goes in `PROJECT.md`.

That separation is what makes the framework portable to your next project.

### 7. Verify

```bash
relay doctor
```

Expect warnings about competing trackers until you delete the old files. Fix
every error before relying on the result.

### 8. Clean up

Once `doctor` is clean and you have read a few migrated logs:

```bash
rm history_*.md history.md todo.md instructions_agents.md
```

Delete the per-harness rule copies too — `relay init` wrote pointers alongside
them. In shared files like `AGENTS.md`, keep the `<!-- relay:start -->` block
and remove only the old protocol text around it.

---

## Worked example — a `.skillframework/` layout

For a project where the framework files live in `.skillframework/`:

```bash
cd ~/Projects/yourproject

# 1. see the plan
relay migrate --from .skillframework

# 2. read it, especially anything marked "mtime (guess)"

# 3. set up relay
relay init --harness claude-code,cursor,warp,kiro,codex

# 4. apply
relay migrate --from .skillframework --apply

# 5. check
relay doctor
relay status
```

Then port `todo.md` → `.relay/tasks.md` and `AGENTS.md` → `.relay/PROJECT.md`
by hand, and delete the originals once you are satisfied.

---

## A project with no index at all

If your old `history.md` was abandoned — or never existed — every file falls
back to dates in contents or mtime. Migration still works, and dates inside the
files are usually reliable, but read the mapping carefully: this is the case
where order is most likely to be wrong.

It is also the strongest argument for the generated index. An index nobody
maintains is worse than no index, because agents trust it.

---

## Rolling back

Migration is additive. The originals stay where they are, so:

```bash
rm -rf .relay/history
relay index
```

That returns you to the pre-migration state with nothing lost.
