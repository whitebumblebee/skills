# Harnesses

relay is deliberately harness-agnostic. The protocol lives in `.relay/`, and
each tool gets a short **pointer file** telling it to read that directory.

This is the opposite of giving every tool its own full copy of the rules. Five
tools means five copies — `CLAUDE.md`, `AGENTS.md`, `WARP.md`, a Cursor rule, a
Kiro steering file — and copies drift apart. A pointer only says where to look,
so it never needs updating when the rules change.

```bash
relay harness                        # list every known harness
relay init --harness cursor,warp     # wire specific ones
relay init --all                     # wire everything
relay harness zed cline              # add more later
```

Pointer files are safe to commit. They contain no secrets and no project
detail — just where to look.

Some of these files are shared: `AGENTS.md`, `CLAUDE.md`, `WARP.md`,
`GEMINI.md`, `CONVENTIONS.md` and `.rules` are read by several tools and often
already hold your own instructions. relay never overwrites them. It appends the
pointer between `<!-- relay:start -->` and `<!-- relay:end -->`, and re-running
`init` or `harness` replaces only that block. Files with `relay` in the name —
`.cursor/rules/relay.mdc`, `.kiro/steering/relay.md` — are relay's own.

---

## Support levels

| Level | Meaning |
| --- | --- |
| **verified** | The path is the tool's documented convention. |
| **agents-md** | The tool reads `AGENTS.md`, the emerging cross-tool standard. |
| **assumed** | A reasonable default. Confirm against your tool's current docs. |

An `assumed` rating does not mean relay fails there. Worst case the pointer is
not auto-loaded and you tell the agent once: *"read `.relay/PROJECT.md`,
`.relay/tasks.md` and `.relay/history.md` first."* Everything after that works
identically, because relay is files plus a CLI, not an integration.

---

## Claude Code — verified

Files: `CLAUDE.md`, `.claude/skills/relay/SKILL.md`

```bash
relay init --harness claude-code
```

`npx skills add` already created `.claude/skills/relay` as a symlink to the
canonical copy in `.agents/skills/relay/`, so the skill is invocable as `/relay`
and loads on demand. `relay init --harness claude-code` adds `CLAUDE.md`, which
Claude Code reads automatically at session start; it also writes the skill file
directly if you installed relay some other way.

For all your projects at once, install globally:

```bash
npx skills@latest add whitebumblebee/skills@relay --global
```

## Cursor — verified

Files: `AGENTS.md`, `.cursor/rules/relay.mdc`

```bash
relay init --harness cursor
```

Cursor reads `AGENTS.md` and every rule in `.cursor/rules/`. relay writes
`relay.mdc` with `alwaysApply: true` front-matter, so the rule loads in every
chat. Without front-matter Cursor treats a rule as manual and only loads it
when you @-mention it.

If you set relay up before this was added, regenerate the rule:

```bash
rm .cursor/rules/relay.mdc
relay harness cursor
```

## OpenAI Codex — verified

File: `AGENTS.md`

```bash
relay init --harness codex
```

Codex reads `AGENTS.md` from the repository root. Nothing else is needed.

## opencode — agents-md

Files: `AGENTS.md`, `.opencode/instructions.md`

```bash
relay init --harness opencode
```

## Warp — verified

File: `WARP.md`

```bash
relay init --harness warp
```

Warp reads `WARP.md` from the workspace root. Because Warp is terminal-native,
`relay status` and `relay doctor` fit naturally into its workflow — consider a
Warp workflow that runs `relay status` when you open the project.

## Kiro — verified

File: `.kiro/steering/relay.md`

```bash
relay init --harness kiro
```

Kiro loads every file under `.kiro/steering/` as always-on guidance.

## Cline — verified

File: `.clinerules/relay.md`

```bash
relay init --harness cline
```

Cline loads every file in the `.clinerules/` folder. The folder form is
preferred over a single `.clinerules` file so relay sits alongside your other
rules instead of replacing them.

## Kilo Code — verified

File: `.kilocode/rules/relay.md`

```bash
relay init --harness kilo-code
```

## Roo Code — verified

File: `.roo/rules/relay.md`

```bash
relay init --harness roo
```

## Windsurf — verified

File: `.windsurf/rules/relay.md`

```bash
relay init --harness windsurf
```

## Zed — agents-md

Files: `AGENTS.md`, `.rules`

```bash
relay init --harness zed
```

## Gemini CLI — verified

File: `GEMINI.md`

```bash
relay init --harness gemini-cli
```

## Aider — verified

File: `CONVENTIONS.md`

```bash
relay init --harness aider
aider --read CONVENTIONS.md
```

Aider does not auto-load conventions; pass `--read` or add it to
`.aider.conf.yml`:

```yaml
read: CONVENTIONS.md
```

## Antigravity — assumed

Files: `AGENTS.md`, `.antigravity/rules/relay.md`

```bash
relay init --harness antigravity
```

`AGENTS.md` is the reliable path here. Confirm the rules directory against
current documentation.

## Command Code, T3 Code, Pi — assumed

File: `AGENTS.md`

```bash
relay init --harness command-code   # or t3-code, or pi
```

These are newer or less documented. relay wires `AGENTS.md`, which most modern
harnesses honour. If yours does not pick it up automatically, paste this once at
the start of a session:

> Read `.relay/PROJECT.md`, `.relay/tasks.md` and `.relay/history.md` before
> doing anything. Claim one task with `relay claim <task> --agent <you>`, and
> write a handoff log with `relay log` before you finish.

## Any other tool — generic

```bash
relay init --harness generic     # writes AGENTS.md only
```

---

## Using several tools on one project

This is the case relay exists for. Wire every tool you use:

```bash
relay init --all
```

Then give each tool a **stable agent name** and always pass it:

```bash
relay claim api-pagination --agent cursor
relay log --agent cursor --task api-pagination
```

The name becomes part of the filename (`0012_cursor_api-pagination.md`), so
consistency matters more than what you choose. Use the tool name, lowercased.

If you run two sessions of the same tool at once, add `--session` to tell them
apart in the log front-matter:

```bash
relay log --agent claude --session claude-b --task api-pagination
```

## Agent names and concurrency

relay allows parallel work, but only under two conditions:

1. Each task has a distinct owner.
2. Their file and infrastructure scopes do not overlap.

If two agents log at the same instant they can take the same sequence number.
`relay doctor` reports this as `duplicate-seq`; fix it by renumbering the later
file to the next free sequence. It is rare, visible, and cheap to repair —
which is the tradeoff relay chooses over locking.
