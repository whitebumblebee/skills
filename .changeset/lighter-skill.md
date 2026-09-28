---
"whitebumblebee-skills": patch
---

relay: load less context every session.

- `SKILL.md` is less than half its previous size (about 800 words, down from 1,750). The procedures agents need only occasionally — taking over a task, new work found mid-task, being blocked, compaction — moved to `docs/`, linked from a reference table so agents open them only when needed.
- `relay init` no longer copies the whole skill into `.claude/skills/relay/`. It writes a short file that registers the skill and points at the installed copy, so it never goes stale after an update.
