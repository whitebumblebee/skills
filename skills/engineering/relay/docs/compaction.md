# Compaction

For the agent. Read this when `relay status` says every task is done, or when
the user asks to compact.

**Ask the user first.** Never compact without their agreement. If they agree:

## 1. Draft

```bash
relay compact
```

This writes `.relay/history/NNNN_relay_compact.md` with the facts: every log's
summary and `next:`, tasks done and carried over, dates, agents.

It refuses while an agent holds a live claim, or while any log still has a
placeholder `summary` or `next`. Open tasks are fine; they carry over.

## 2. Write the summary with the user

Read the round's logs, then fill in the draft:

- **What is true now** — keep it short, 5–15 lines. Every future agent reads it.
- **What was built** — grouped by feature or area, not by session.
- **Decisions and why** — choices a later agent might otherwise undo.
- **Still open or risky** — bugs, shortcuts, unverified assumptions.
- **Moved to PROJECT.md** — move anything that stays true (rules, constraints)
  into `PROJECT.md`, and list it here.

Replace the placeholder `summary:` and `next:` in the front-matter. If the
draft mentions an earlier round's summary, carry forward whatever in it is
still true — this entry replaces it.

## 3. Finish

```bash
relay compact --finish
```

This deletes the round's logs, renames the summary to `0001_relay_compact.md`,
removes finished tasks, and regenerates the index. The next log is `0002`.

If git cannot restore the deleted logs — no repository, or logs not committed —
it refuses. Tell the user the deletion is permanent, and only with their
agreement run:

```bash
relay compact --finish --confirm-delete
```

See [cli.md](cli.md#relay-compact) for every detail.
