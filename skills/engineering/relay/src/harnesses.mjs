/**
 * Harness registry.
 *
 * Every entry here resolves to the same tiny pointer file. That is the point:
 * the protocol lives in exactly one place (`.relay/`), and each harness gets a
 * stub telling it where to look. A full copy of the rules per harness would
 * drift apart as soon as one copy was edited.
 *
 * `confidence: "verified"` means the path is the harness's documented
 * convention. `"agents-md"` means the harness reads the cross-tool AGENTS.md
 * standard. `"assumed"` means it is a reasonable guess that you should confirm
 * against your harness's current docs — relay still works, because any harness
 * can be pointed at `.relay/` manually.
 */
import path from "node:path";

export const AGENTS_MD = "AGENTS.md";

export const HARNESSES = {
  "claude-code": {
    label: "Claude Code",
    files: ["CLAUDE.md", ".claude/skills/relay/SKILL.md"],
    confidence: "verified",
    note: "CLAUDE.md is read automatically. The skill copy makes /relay invocable.",
  },
  cursor: {
    label: "Cursor",
    files: [AGENTS_MD, ".cursor/rules/relay.mdc"],
    confidence: "verified",
    note: "Cursor reads AGENTS.md and .cursor/rules/*.mdc.",
  },
  codex: {
    label: "OpenAI Codex",
    files: [AGENTS_MD],
    confidence: "verified",
    note: "Codex reads AGENTS.md from the repo root.",
  },
  opencode: {
    label: "opencode",
    files: [AGENTS_MD, ".opencode/instructions.md"],
    confidence: "agents-md",
    note: "opencode follows the AGENTS.md convention.",
  },
  warp: {
    label: "Warp",
    files: ["WARP.md"],
    confidence: "verified",
    note: "Warp reads WARP.md from the workspace root.",
  },
  kiro: {
    label: "Kiro",
    files: [".kiro/steering/relay.md"],
    confidence: "verified",
    note: "Kiro loads every file under .kiro/steering/ as always-on guidance.",
  },
  cline: {
    label: "Cline",
    files: [".clinerules/relay.md"],
    confidence: "verified",
    note: "Cline loads every file in the .clinerules/ folder.",
  },
  "kilo-code": {
    label: "Kilo Code",
    files: [".kilocode/rules/relay.md"],
    confidence: "verified",
    note: "Kilo Code loads .kilocode/rules/*.",
  },
  roo: {
    label: "Roo Code",
    files: [".roo/rules/relay.md"],
    confidence: "verified",
    note: "Roo Code loads .roo/rules/*.",
  },
  windsurf: {
    label: "Windsurf",
    files: [".windsurf/rules/relay.md"],
    confidence: "verified",
    note: "Windsurf loads .windsurf/rules/*.",
  },
  zed: {
    label: "Zed",
    files: [AGENTS_MD, ".rules"],
    confidence: "agents-md",
    note: "Zed's agent reads AGENTS.md and .rules.",
  },
  antigravity: {
    label: "Antigravity",
    files: [AGENTS_MD, ".antigravity/rules/relay.md"],
    confidence: "assumed",
    note: "Falls back to AGENTS.md. Confirm the rules path against current docs.",
  },
  "gemini-cli": {
    label: "Gemini CLI",
    files: ["GEMINI.md"],
    confidence: "verified",
    note: "Gemini CLI reads GEMINI.md.",
  },
  aider: {
    label: "Aider",
    files: ["CONVENTIONS.md"],
    confidence: "verified",
    note: "Add with: aider --read CONVENTIONS.md",
  },
  "command-code": {
    label: "Command Code",
    files: [AGENTS_MD],
    confidence: "assumed",
    note: "Uses the AGENTS.md standard. Point it at .relay/ manually if it does not pick this up.",
  },
  "t3-code": {
    label: "T3 Code",
    files: [AGENTS_MD],
    confidence: "assumed",
    note: "Uses the AGENTS.md standard. Point it at .relay/ manually if it does not pick this up.",
  },
  pi: {
    label: "Pi",
    files: [AGENTS_MD],
    confidence: "assumed",
    note: "Uses the AGENTS.md standard. Point it at .relay/ manually if it does not pick this up.",
  },
  generic: {
    label: "Any other harness",
    files: [AGENTS_MD],
    confidence: "agents-md",
    note: "AGENTS.md is the closest thing to a cross-tool standard.",
  },
};

export const ALL_HARNESSES = Object.keys(HARNESSES);

/**
 * Files other tools and the user also write to — `AGENTS.md`, `CLAUDE.md` and
 * the like. relay adds a marked block to these instead of owning them. Files
 * with `relay` in the name are relay's alone.
 */
export function isShared(rel) {
  return !path.basename(rel).includes("relay");
}

/**
 * The pointer every harness file contains. Short by design — it must not drift.
 * It starts at a second-level heading because it is usually a block inside a
 * file the user already owns.
 */
export function pointer(projectName) {
  return `## relay — how agents hand off work on ${projectName}

This project uses **relay** to hand work between AI coding agents without
losing context. Several agents, in different tools, with separate context
windows and credit limits, work on this repository. Chat transcripts are not
shared memory. The files under \`.relay/\` are.

**Running relay.** The CLI ships inside the relay skill and is usually not on
\`PATH\`. Use the first of these that works — commands below are written as
plain \`relay\`:

1. \`relay\`
2. \`node .agents/skills/relay/bin/relay.mjs\`
3. \`node ~/.agents/skills/relay/bin/relay.mjs\`

If none work, follow the same rules by editing the \`.relay/\` files by hand.

**If \`.relay/history/0001_relay_bootstrap.md\` still has \`TODO:\` in its
\`summary:\` or \`next:\`, relay setup is unfinished — finish it with the user
first, following \`docs/setup.md\` in the relay skill.**

**Before doing anything, read in this order:**

1. \`.relay/PROJECT.md\` — architecture and invariants you must not break
2. \`.relay/tasks.md\` — the authoritative tracker; the next unblocked task
3. \`.relay/history.md\` — generated index of every prior session
4. The newest \`.relay/history/NNNN_*.md\` entries that relate to your task

Then inspect the actual code, tests, and running state. History records what
was true when it was written; it does not override the current repository.

**The rules, in short:**

- Claim exactly one task before editing: \`relay claim <task> --agent <you>\`,
  and re-run it between major steps to renew the claim
- Never take a task someone else holds unless its claim has expired or the
  user asks you to continue it
- Before marking anything done: run the gates, then \`relay log\`, then
  \`relay done\`
- Every log must end with a real \`next:\` — the single action the following
  agent should take
- Never write secret values into history, task notes, or terminal summaries
- Do not commit, push, deploy, or spend money unless the user asked for it

Run \`relay status\` to see where things stand, and \`relay doctor\` before you
hand off. Full protocol: \`.relay/PROJECT.md\` and the relay README.
`;
}

/**
 * The contents of a relay-owned harness file. Cursor treats an `.mdc` rule
 * without front-matter as manual — loaded only when @-mentioned — so the rule
 * declares itself always-on.
 */
export function harnessFile(rel, projectName) {
  const text = pointer(projectName);
  if (!rel.endsWith(".mdc")) return text;
  return `---
description: relay handoff protocol — read .relay/ before any work, claim one task, log before handing off
alwaysApply: true
---

${text}`;
}
