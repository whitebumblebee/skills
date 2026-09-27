/**
 * relay — shared primitives.
 *
 * Deliberately dependency-free: relay runs inside whatever sandbox a coding
 * agent happens to have, and `npm install` is not always available or allowed.
 * Node 18+ and nothing else.
 */
import fs from "node:fs";
import path from "node:path";

export const DIR = ".relay";
export const HISTORY_DIR = "history";
export const SEQ_PAD = 4;

export const DEFAULT_CONFIG = {
  // How long a claim stays valid without renewal. Agents renew by re-running
  // `relay claim` (and `relay log` renews too), so this is the window between
  // an agent dying — a credit limit, a closed laptop, a crash — and everyone
  // else being allowed to assume so.
  claimTtlHours: 1,
  // `relay doctor` warns once this many commits of real work have landed
  // since the last commit that included a history log.
  unloggedCommitsWarn: 5,
  // Commands another agent should run before marking work done. Project-specific;
  // `relay doctor` only checks that they are declared, never runs them.
  gates: [],
  // Extra paths doctor scans for competing trackers.
  trackerAliases: [
    "todo.md",
    "TODO.md",
    "build_plan.md",
    "plan_high.md",
    "project-handoff.md",
    "DEV_READY.md",
  ],
};

/* ------------------------------------------------------------------ paths */

/** Walk up from `start` looking for a `.relay/` directory. */
export function findRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, DIR))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireRoot(start = process.cwd()) {
  const root = findRoot(start);
  if (!root) {
    throw new UserError(
      `No ${DIR}/ directory found in this directory or any parent.\n` +
        `Run \`relay init\` at your project root first.`,
    );
  }
  return root;
}

export const paths = (root) => ({
  root,
  dir: path.join(root, DIR),
  config: path.join(root, DIR, "config.json"),
  project: path.join(root, DIR, "PROJECT.md"),
  tasks: path.join(root, DIR, "tasks.md"),
  index: path.join(root, DIR, "history.md"),
  historyDir: path.join(root, DIR, HISTORY_DIR),
});

export function readConfig(root) {
  const p = paths(root).config;
  if (!fs.existsSync(p)) return { ...DEFAULT_CONFIG };
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch (err) {
    throw new UserError(`${p} is not valid JSON: ${err.message}`);
  }
}

/* ------------------------------------------------------------- frontmatter */

/**
 * Parse a minimal YAML subset: `key: scalar` and `key: [a, b]`.
 *
 * Full YAML is not worth a dependency here. History front-matter is written by
 * agents and read by this tool; keeping the grammar small keeps it predictable
 * for both. Anything richer belongs in the markdown body.
 */
export function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text };
  const raw = text.slice(text.indexOf("\n") + 1, end);
  // `end + 4` lands just past the closing `---`. Drop the newline that
  // terminates that line, plus one blank line if the author left one.
  const body = text.slice(end + 4).replace(/^\r?\n(?:\r?\n)?/, "");
  const data = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    data[key] = parseScalar(line.slice(idx + 1).trim());
  }
  return { data, body };
}

function parseScalar(v) {
  if (v === "") return "";
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => parseScalar(s.trim()));
  }
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

export function serializeFrontmatter(data) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    lines.push(`${k}: ${serializeScalar(v)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function serializeScalar(v) {
  if (Array.isArray(v)) return `[${v.map(serializeScalar).join(", ")}]`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  // Quote anything that could be misread as structure or a different type.
  if (
    s === "" ||
    /[:#\[\]{}",]/.test(s) ||
    /^(true|false|-?\d+)$/.test(s) ||
    s !== s.trim()
  ) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

/* ----------------------------------------------------------------- naming */

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function pad(n) {
  return String(n).padStart(SEQ_PAD, "0");
}

/**
 * `0007_claude_staging-deploy.md`
 *
 * The leading sequence is the whole point: ordering lives in the filename, so
 * `ls` alone tells a fresh agent what happened in what order across every
 * harness. No index needs to be trusted for that.
 */
export function historyFilename(seq, agent, task) {
  const slug = slugify(task || "work");
  return `${pad(seq)}_${slugify(agent)}${slug ? `_${slug}` : ""}.md`;
}

export function parseHistoryFilename(name) {
  const m = /^(\d{3,})_([a-z0-9-]+?)(?:_([a-z0-9-]+))?\.md$/.exec(name);
  if (!m) return null;
  return { seq: Number(m[1]), agent: m[2], task: m[3] || null, file: name };
}

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function addHours(iso, hours) {
  const d = new Date(iso);
  d.setTime(d.getTime() + hours * 3600 * 1000);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/* ---------------------------------------------------------------- history */

/** Every valid history entry, ascending by sequence. */
export function readHistory(root) {
  const dir = paths(root).historyDir;
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".md")) continue;
    const parsed = parseHistoryFilename(name);
    if (!parsed) continue;
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    const { data } = parseFrontmatter(text);
    out.push({ ...parsed, data, path: path.join(dir, name) });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

/** Files sitting in history/ that relay cannot read. */
export function readHistoryOrphans(root) {
  const dir = paths(root).historyDir;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".md") && !parseHistoryFilename(n))
    .sort();
}

export function nextSeq(root) {
  const entries = readHistory(root);
  const orphanMax = readHistoryOrphans(root).length ? 0 : 0;
  void orphanMax;
  return entries.length ? entries[entries.length - 1].seq + 1 : 1;
}

/* ------------------------------------------------------------------ misc */

export class UserError extends Error {}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function read(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

export function write(p, content) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content.endsWith("\n") ? content : `${content}\n`);
}
