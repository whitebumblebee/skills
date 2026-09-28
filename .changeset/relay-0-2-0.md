---
"whitebumblebee-skills": minor
---

relay: adopt existing projects, hand off safely, and compact finished work.

- `relay init` recognises three situations — an empty project, one with git history, and one with code but no git — and for existing projects writes a first history entry from what it finds. The agent then interviews you to fill in `PROJECT.md` and a prioritised `tasks.md`, asking where every suggestion belongs: now, next, later, or not needed.
- Existing `AGENTS.md`, `CLAUDE.md` and similar files get a marked relay section instead of being skipped; your own content is untouched.
- Claims last an hour and are renewed by re-running `relay claim` or writing a log. Asking an agent to continue another's task hands it over; otherwise a live claim is refused with evidence — when the holder was last active, its logs, and its likely leftover work.
- `relay status` and `relay doctor` report commits made without a handoff log.
- New `relay compact`: when every task is done, fold the round's logs into one summary that starts the next round.
- `relay doctor` warns when `PROJECT.md` is still the template or `tasks.md` still has the placeholder task, and when a setup or compaction was left unfinished.
- Fixed: the Cursor rule now loads automatically, and pointer files say where to find the CLI, since it is not on `PATH`.
- Fixed: `--force` no longer reopens a finished task.
