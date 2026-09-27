/**
 * Adopting relay into a project that already exists.
 *
 * `relay init` sorts every project into one of three modes:
 *
 *   new   Nothing here yet. History is legitimately empty; the first real
 *         task becomes entry 0001.
 *   git   Existing work with git history. The bootstrap entry is built from
 *         the log: dates, contributors, recent commits, the files that churn.
 *   code  Existing work without usable git history. The bootstrap entry is
 *         built from the working tree, and the adopting agent has to read the
 *         code to form its own picture before asking the user anything.
 *
 * The split of labour is deliberate. This file collects facts mechanically —
 * relay has no model and never touches the network. Everything that needs
 * judgment (where the project stands, what is half-done, what is broken, what
 * comes next) is left as a placeholder for the adopting agent, and `relay
 * doctor` fails until it is written. See docs/setup.md.
 */
import fs from "node:fs";
import path from "node:path";
import { nowIso, read, readConfig, serializeFrontmatter } from "./core.mjs";
import { commitCount, gitFacts, head } from "./git.mjs";

export const MODES = ["new", "git", "code"];

export const MODE_LABELS = {
  new: "new project",
  git: "existing project with git history",
  code: "existing project without git history",
};

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", "target", "vendor", "coverage",
  "__pycache__", "venv", "env", "bower_components", "Pods", "DerivedData",
]);

// Files that exist in an otherwise empty repository: GitHub's "initialise with
// README and LICENSE", and the entry files relay itself writes.
const BOILERPLATE = /^(readme|license|licence|copying|agents|claude|warp|gemini|conventions)(\.[a-z]+)?$/i;

const MANIFESTS = [
  "package.json", "pyproject.toml", "requirements.txt", "Pipfile", "Cargo.toml",
  "go.mod", "Gemfile", "composer.json", "pom.xml", "build.gradle", "build.gradle.kts",
  "mix.exs", "pubspec.yaml", "deno.json", "Package.swift",
];

const CI_DEPLOY = [
  ".gitlab-ci.yml", ".circleci/config.yml", "azure-pipelines.yml", "bitbucket-pipelines.yml",
  "Jenkinsfile", "vercel.json", "netlify.toml", "fly.toml", "render.yaml", "railway.json",
  "Procfile", "app.yaml", "serverless.yml", "wrangler.toml", "Dockerfile",
  "docker-compose.yml", "compose.yaml",
];

const AGENT_FILES = [
  "AGENTS.md", "CLAUDE.md", "WARP.md", "GEMINI.md", "CONVENTIONS.md", ".cursorrules",
  ".windsurfrules", ".clinerules", ".github/copilot-instructions.md", ".cursor/rules",
  ".kiro/steering", ".roo/rules", ".windsurf/rules",
];

const LEGACY = /^history_[a-z0-9-]+_\d+\.md$/i;

/* ------------------------------------------------------------- detection */

/**
 * Which mode `init` should run in. Content decides whether the project is new;
 * git decides which kind of existing project it is. A repository with a
 * single commit counts as having no history — that is usually a scaffold
 * (`create-next-app`, `rails new`) or code committed in one go, and either
 * way the code, not the log, is what the adopting agent must read.
 */
export function detectMode(root) {
  const scan = scanTree(root, { limit: 50 });
  if (!scan.files.length) return "new";
  return commitCount(root) >= 2 ? "git" : "code";
}

/** Where legacy `history_<agent>_<NN>.md` files live, if anywhere. */
export function findLegacyHistory(root) {
  for (const dir of [".", ".skillframework"]) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    if (fs.readdirSync(full).some((n) => LEGACY.test(n))) return dir;
  }
  return null;
}

/* ------------------------------------------------------------------ scan */

/**
 * Walk the working tree, skipping dependencies, build output and dotfiles.
 * Bounded, because adoption must stay fast on a large monorepo.
 */
export function scanTree(root, { limit = 20000 } = {}) {
  const files = [];
  const stack = [""];
  while (stack.length && files.length < limit) {
    const rel = stack.pop();
    let names;
    try {
      names = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of names) {
      if (d.name.startsWith(".") || SKIP_DIRS.has(d.name)) continue;
      const child = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) stack.push(child);
      else if (d.isFile() && !(rel === "" && BOILERPLATE.test(d.name))) {
        let mtime = null;
        try {
          mtime = fs.statSync(path.join(root, child)).mtime;
        } catch {
          /* raced with a delete */
        }
        files.push({ path: child, mtime });
        if (files.length >= limit) break;
      }
    }
  }
  return { files, truncated: files.length >= limit };
}

const exists = (root, rel) => fs.existsSync(path.join(root, rel));

function countFiles(root, rel) {
  const full = path.join(root, rel);
  try {
    return fs.statSync(full).isDirectory() ? fs.readdirSync(full).length : 1;
  } catch {
    return 0;
  }
}

function packageJson(root) {
  const text = read(path.join(root, "package.json"));
  if (!text) return null;
  try {
    const pkg = JSON.parse(text);
    return {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      scripts: Object.keys(pkg.scripts || {}),
      dependencies: Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }),
    };
  } catch {
    return null;
  }
}

function changelogHeadings(root) {
  for (const name of ["CHANGELOG.md", "CHANGES.md", "HISTORY.md", "RELEASES.md"]) {
    const text = read(path.join(root, name));
    if (text) {
      return {
        file: name,
        headings: text
          .split(/\r?\n/)
          .filter((l) => /^#{2,3}\s/.test(l))
          .slice(0, 15)
          .map((l) => l.replace(/^#+\s*/, "")),
      };
    }
  }
  return null;
}

/** Everything the bootstrap entry records about the working tree. */
export function projectFacts(root) {
  const tree = scanTree(root);
  const byTop = new Map();
  for (const f of tree.files) {
    const top = f.path.includes("/") ? `${f.path.split("/")[0]}/` : "(root)";
    byTop.set(top, (byTop.get(top) || 0) + 1);
  }
  const workflows = exists(root, ".github/workflows")
    ? fs.readdirSync(path.join(root, ".github/workflows")).map((n) => `.github/workflows/${n}`)
    : [];
  const dated = tree.files.filter((f) => f.mtime).sort((a, b) => b.mtime - a.mtime);

  return {
    fileCount: tree.files.length,
    truncated: tree.truncated,
    topDirs: [...byTop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
    manifests: MANIFESTS.filter((m) => exists(root, m)),
    pkg: packageJson(root),
    ciDeploy: [
      ...workflows,
      ...CI_DEPLOY.filter((f) => exists(root, f)),
      ...(tree.files.some((f) => f.path.endsWith(".tf")) ? ["Terraform (*.tf)"] : []),
    ],
    docs: [
      ...["README.md", "README"].filter((f) => exists(root, f)),
      ...(exists(root, "docs") ? [`docs/ (${countFiles(root, "docs")} entries)`] : []),
    ],
    changelog: changelogHeadings(root),
    agentFiles: AGENT_FILES.filter((f) => exists(root, f)),
    trackers: readConfig(root).trackerAliases.filter((f) => exists(root, f)),
    newest: dated.slice(0, 5),
    oldest: dated.length > 5 ? dated.slice(-3).reverse() : [],
  };
}

/* ------------------------------------------------------------- bootstrap */

export const BOOTSTRAP_FILE = "0001_relay_bootstrap.md";

export function buildBootstrap(root, mode, projectName) {
  const facts = projectFacts(root);
  const g = mode === "git" ? gitFacts(root) : null;
  const front = serializeFrontmatter({
    seq: 1,
    agent: "relay",
    date: nowIso(),
    task: "bootstrap",
    status: "partial",
    summary: "TODO: one line — what this project is and where it stands as relay is adopted.",
    next: "TODO: the single most important next action, agreed with the user.",
    supersedes: [],
    bootstrap: mode,
    git_head: head(root) || undefined,
  });
  return `${front}\n\n${bootstrapBody(projectName, mode, facts, g)}`;
}

const day = (d) => (d ? d.toISOString().slice(0, 10) : "?");
const list = (items, empty = "none found") => (items.length ? items.join(", ") : empty);

function bootstrapBody(name, mode, f, g) {
  const out = [];
  out.push(`# ${name} — relay bootstrap`, "");
  out.push(
    "<!-- Written by `relay init` when relay was adopted into an existing project.",
    '     "Facts collected at adoption" was gathered mechanically and is safe to trust',
    "     as far as it goes. Every other section is for the adopting agent to write,",
    "     together with the user — follow docs/setup.md in the relay skill.",
    "     `relay doctor` fails until `summary:` and `next:` above are real. -->",
    "",
  );

  out.push("## Facts collected at adoption", "");
  out.push(
    mode === "git"
      ? `Source: **git history** (${g.commits} commits) and the working tree.`
      : "Source: **the working tree only** — there is no usable git history. Dates below are file modification times, which copying or checking out resets; treat them as a guess.",
    "",
  );

  if (g) {
    out.push(
      `- Git: branch \`${g.branch}\`, ${g.commits} commits from ${g.firstDate} to ${g.lastDate}, head \`${g.head}\``,
      `- Contributors: ${list(g.contributors.slice(0, 8).map((c) => `${c.name} (${c.commits})`))}`,
      `- Tags: ${list(g.tags)}`,
      `- Uncommitted changes at adoption: ${g.dirty} file(s)`,
    );
  }
  out.push(`- Files (excluding dependencies, build output, dotfiles): ${f.fileCount}${f.truncated ? "+" : ""}`);
  out.push(`- Where they live: ${list(f.topDirs.map(([d, n]) => `${d} ${n}`))}`);
  out.push(`- Manifests: ${list(f.manifests)}`);
  if (f.pkg) {
    const p = f.pkg;
    out.push(
      `- package.json: ${[p.name, p.version].filter(Boolean).join("@") || "unnamed"}${p.description ? ` — ${p.description}` : ""}`,
      `  - scripts: ${list(p.scripts)}`,
      `  - dependencies (${p.dependencies.length}): ${list(p.dependencies.slice(0, 25))}${p.dependencies.length > 25 ? ", …" : ""}`,
    );
  }
  out.push(`- CI and deployment config: ${list(f.ciDeploy)}`);
  out.push(`- Docs: ${list(f.docs)}`);
  out.push(`- Existing agent instructions: ${list(f.agentFiles)}`);
  out.push(`- Other trackers or plans: ${list(f.trackers)}`);
  out.push("");

  if (g && g.recent.length) {
    out.push(`### Recent commits`, "", "```", ...g.recent, "```", "");
  }
  if (g && g.hotFiles.length) {
    out.push(
      "### Most-changed files",
      "",
      ...g.hotFiles.map((h) => `- \`${h.file}\` (${h.count})`),
      "",
    );
  }
  if (f.changelog && f.changelog.headings.length) {
    out.push(`### Timeline from ${f.changelog.file}`, "", ...f.changelog.headings.map((h) => `- ${h}`), "");
  }
  if (!g && f.newest.length) {
    out.push(
      "### Last modified (modification times — a guess)",
      "",
      ...f.newest.map((x) => `- \`${x.path}\` — ${day(x.mtime)}`),
      ...(f.oldest.length ? ["", "Oldest:", ...f.oldest.map((x) => `- \`${x.path}\` — ${day(x.mtime)}`)] : []),
      "",
    );
  }

  const agent = (text) => `<!-- ${text} -->`;
  out.push(
    "## What this project is",
    "",
    agent("Your own understanding, from reading the code, then confirmed with the user."),
    "",
    "## Where it stands",
    "",
    agent("What works today, how mature it is, what is deployed where."),
    "",
    "## Half-done work",
    "",
    agent("Started but unfinished — branches, TODOs in code, partial features, uncommitted changes."),
    "",
    "## Known broken or risky",
    "",
    agent("Failing tests, fragile areas, security or data risks. Anything the next agent would be burned by."),
    "",
    "## Sources relied on",
    "",
    agent(
      "Every file, doc, commit range and user answer this entry is based on. Mark anything you could not confirm.",
    ),
    "",
    "## Next",
    "",
    agent("Mirror `next:` above, with enough detail to act on."),
    "",
  );
  return out.join("\n");
}
