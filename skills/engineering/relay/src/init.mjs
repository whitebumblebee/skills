import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  DIR,
  UserError,
  ensureDir,
  paths,
  write,
} from "./core.mjs";
import { ALL_HARNESSES, HARNESSES, pointer } from "./harnesses.mjs";
import { writeIndex } from "./history.mjs";

export function runInit(root, { harnesses = [], force = false, name } = {}) {
  const p = paths(root);
  const projectName = name || path.basename(root);
  const created = [];
  const skipped = [];

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

  put(p.project, projectTemplate(projectName));
  put(p.tasks, tasksTemplate(projectName));
  put(p.config, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);

  // history.md is generated, so write it through the generator even when empty.
  if (!fs.existsSync(p.index) || force) {
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
      // A skill file needs its own YAML front-matter to register with the
      // harness, so these get the real skill rather than a pointer to it.
      put(path.join(root, rel), rel.endsWith("skills/relay/SKILL.md") ? skillBody() : text);
    }
  }

  return { created, skipped, projectName, harnesses: selected };
}

/** The packaged skill, shipped verbatim so harnesses see its front-matter. */
function skillBody() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(here, "..", "SKILL.md"), "utf8");
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
- [~] \`slug\` — IN_PROGRESS — agent — 2026-01-01T00:00:00Z — expires 2026-01-01T04:00:00Z
- [!] \`slug\` — BLOCKED — waiting on the human to add the OAuth redirect URI
- [x] \`slug\` — DONE — 0007
\`\`\`

Prefer \`relay claim\` and \`relay done\` over editing these lines by hand — they
set the timestamps and expiry for you, and refuse to steal a live claim.
Indented lines under a task are free-form notes and are preserved.

## Now

- [ ] \`first-task\` — TODO
  - Replace this with real work. Keep slugs short, stable, and specific.

## Next

## Someday
`;
}

export { DIR };
