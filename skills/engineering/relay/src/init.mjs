import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  DIR,
  UserError,
  ensureDir,
  paths,
  read,
  readHistory,
  write,
} from "./core.mjs";
import { ALL_HARNESSES, HARNESSES, harnessFile, isShared, pointer } from "./harnesses.mjs";
import { writeIndex } from "./history.mjs";
import { commitCount } from "./git.mjs";
import {
  BOOTSTRAP_FILE,
  MODES,
  buildBootstrap,
  detectMode,
  findLegacyHistory,
} from "./adopt.mjs";

export const BLOCK_START = "<!-- relay:start -->";
export const BLOCK_END = "<!-- relay:end -->";

/**
 * Set relay up in `root`.
 *
 * `mode` is detected on the first run (see adopt.mjs) and can be forced. The
 * bootstrap entry is only written on the first run or when a mode is forced —
 * re-running `init` to add a harness must never start generating history.
 */
export function runInit(root, { harnesses = [], force = false, name, mode } = {}) {
  const p = paths(root);
  const projectName = name || path.basename(root);
  const firstRun = !fs.existsSync(p.dir);
  const created = [];
  const updated = [];
  const skipped = [];

  if (mode !== undefined && !MODES.includes(mode)) {
    throw new UserError(`--mode must be one of: ${MODES.join(", ")}`);
  }
  if (mode === "git" && commitCount(root) < 2) {
    throw new UserError("--mode git needs a git repository with at least two commits here.");
  }
  const resolvedMode = mode || detectMode(root);

  ensureDir(p.dir);
  ensureDir(p.historyDir);

  const put = (file, content) => {
    if (fs.existsSync(file) && !force) {
      skipped.push(path.relative(root, file));
      return;
    }
    write(file, content);
    created.push(path.relative(root, file));
  };

  // Files like AGENTS.md belong to the user and other tools. relay owns only
  // the block between its markers, so the user's content is never touched and
  // re-running replaces the block instead of appending a second copy.
  const merge = (file, block) => {
    const rel = path.relative(root, file);
    const wrapped = `${BLOCK_START}\n${block.trim()}\n${BLOCK_END}`;
    const current = read(file);
    if (current === null) {
      write(file, `# ${projectName} — agent instructions\n\n${wrapped}\n`);
      created.push(rel);
      return;
    }
    const s = current.indexOf(BLOCK_START);
    const e = current.indexOf(BLOCK_END);
    const next =
      s !== -1 && e > s
        ? current.slice(0, s) + wrapped + current.slice(e + BLOCK_END.length)
        : `${current.trimEnd()}\n\n${wrapped}\n`;
    if (next === current) {
      skipped.push(rel);
      return;
    }
    write(file, next);
    updated.push(rel);
  };

  put(p.project, projectTemplate(projectName));
  put(p.tasks, tasksTemplate(projectName));
  put(p.config, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);

  // Pre-relay history becomes a single bootstrap entry, not one per commit:
  // relay logs record why and what next, which commits do not carry, and
  // hundreds of commit-shaped rows would bury the index. Legacy relay-style
  // logs take precedence — those should be migrated, not summarised.
  const legacy = resolvedMode === "new" ? null : findLegacyHistory(root);
  let bootstrap = null;
  if (
    resolvedMode !== "new" &&
    !legacy &&
    (firstRun || mode) &&
    readHistory(root).length === 0
  ) {
    write(path.join(p.historyDir, BOOTSTRAP_FILE), buildBootstrap(root, resolvedMode, projectName));
    bootstrap = path.relative(root, path.join(p.historyDir, BOOTSTRAP_FILE));
    created.push(bootstrap);
  }

  // history.md is generated, so write it through the generator even when empty.
  if (!fs.existsSync(p.index) || force || bootstrap) {
    writeIndex(root);
    created.push(path.relative(root, p.index));
  } else {
    skipped.push(path.relative(root, p.index));
  }

  const selected = harnesses.length ? harnesses : ["generic"];
  const unknown = selected.filter((h) => !HARNESSES[h]);
  if (unknown.length) {
    throw new UserError(
      `Unknown harness: ${unknown.join(", ")}\nKnown: ${ALL_HARNESSES.join(", ")}`,
    );
  }

  const text = pointer(projectName);
  const written = new Set();
  for (const id of selected) {
    for (const rel of HARNESSES[id].files) {
      if (written.has(rel)) continue;
      written.add(rel);
      const file = path.join(root, rel);
      if (rel.endsWith("skills/relay/SKILL.md")) put(file, skillPointer(root));
      else if (isShared(rel)) merge(file, text);
      else put(file, harnessFile(rel, projectName));
    }
  }

  return {
    created,
    updated,
    skipped,
    projectName,
    harnesses: selected,
    mode: resolvedMode,
    bootstrap,
    legacy,
  };
}

/** Where the setup guide lives, for pointing users and agents at it. */
export function setupGuidePath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "docs", "setup.md");
}

/**
 * A harness skill file that registers relay under the real skill's
 * front-matter but points at the installed skill for everything else. A full
 * copy would go stale on every relay update, and its links to docs/ would not
 * resolve from another directory.
 */
function skillPointer(root) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const skillDir = path.join(here, "..");
  const source = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  const front = source.slice(0, source.indexOf("\n---", 3) + 4);
  const rel = path.relative(root, skillDir);
  const where = rel && !rel.startsWith("..") ? rel : skillDir;
  return `${front}

# relay

The relay skill is installed at \`${where}\`. Read \`${where}/SKILL.md\` and
follow it. Its \`docs/\` folder, next to it, holds the procedures it links to.
`;
}

function projectTemplate(name) {
  return `# ${name} — project invariants

<!-- This file is YOURS. relay never rewrites it.
     Keep it short enough that an arriving agent will actually read it, and
     specific enough that it prevents a real mistake. Everything here should be
     something you would otherwise have to say twice. -->

## What this project is

<!-- Two or three sentences. What it does, who uses it, what "working" means. -->

## Architecture you must not break

<!-- The invariants that are expensive to rediscover. For example:
     - AI calls are server-only; never import the model client into a client bundle
     - Tenant isolation: every query filters by the authenticated user id
     - Migrations are additive only; never restructure a column in place -->

## Environments

| Environment | Where | Notes |
| --- | --- | --- |
| production | | Never deploy here without being asked |
| staging | | |
| local | | |

## Validation gates

Run these before marking any task done. Record the actual output in your log.

\`\`\`bash
# e.g. npx tsc --noEmit && npm run lint && npm test && npm run build
\`\`\`

## Actions that need the human

Some things an agent must not do alone. List them so nobody has to guess:

- Committing, pushing, or opening pull requests
- Deploying to production; deleting cloud resources; rotating secrets
- Anything that spends money
- Console-only work: OAuth consent screens, billing, DNS, account verification

When you hit one, mark the task \`BLOCKED\` with exactly what the human must do,
where, and how you will verify it afterwards.

## Deferred and declined

<!-- Things the user chose to do later, or not at all, and why — so agents stop
     re-suggesting them. Deferred items that have a place in the plan also
     appear as tasks in tasks.md, in priority order. For example:
     - Payments — later, after the first 100 users
     - Kubernetes — declined; the Vercel deploy is enough
     - Deployment target — undecided -->

## Precedence

When sources disagree, this is the order:

1. The user's newest explicit instruction
2. This file
3. \`.relay/tasks.md\`
4. The current code, tests, and deployed state
5. \`.relay/history.md\` and the logs, as historical record

Plans and design documents are subordinate to \`tasks.md\`. If a plan says one
thing and \`tasks.md\` says another, \`tasks.md\` is what is actually happening.
`;
}

function tasksTemplate(name) {
  return `# ${name} — tasks

This is the **authoritative tracker**. One task, one owner, one state.

States: \`TODO\`, \`IN_PROGRESS\`, \`BLOCKED\`, \`DONE\`

\`\`\`
- [ ] \`slug\` — TODO
- [~] \`slug\` — IN_PROGRESS — agent — 2026-01-01T00:00:00Z — seen 2026-01-01T00:40:00Z — expires 2026-01-01T01:40:00Z
- [!] \`slug\` — BLOCKED — waiting on the human to add the OAuth redirect URI
- [x] \`slug\` — DONE — 0007
\`\`\`

**Order is priority.** Agents pick the first \`TODO\` from the top of this file,
so keep tasks in the order the user wants them done. The headings below are
priority buckets; replace them with phases (\`## Phase 1 — MVP\`) if that fits
the project better.

Prefer \`relay claim\` and \`relay done\` over editing these lines by hand — they
set the timestamps and expiry for you, and refuse to steal a live claim.
Indented lines under a task are free-form notes and are preserved.

## Now

- [ ] \`first-task\` — TODO
  - Replace this with real work. Keep slugs short, stable, and specific.

## Next

## Later
`;
}

export { DIR };
