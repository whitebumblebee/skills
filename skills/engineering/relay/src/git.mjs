/**
 * Read-only git queries.
 *
 * relay never writes to git — no commits, no `git init`, nothing that changes a
 * repository. It only reads, locally, to answer two questions: how much history
 * does this project already have, and how much work has happened since the last
 * handoff log.
 *
 * Every query is scoped to the project root (`-- .`), so a project living in a
 * subdirectory of a larger repository sees its own history, not the monorepo's.
 * Every function degrades to `null`/empty when git is missing, the directory is
 * not a repository, or the repository has no commits.
 */
import { execFileSync } from "node:child_process";

function git(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
      // Only trailing whitespace: `status --porcelain` starts lines with a
      // meaningful space (" M file").
    }).trimEnd();
  } catch {
    return null;
  }
}

// Commits that only touch .relay/ are bookkeeping (claims, logs), not work.
const WORK = ["--", ".", ":(exclude).relay"];

export function isGitRepo(root) {
  return git(root, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

/** Commits that touched this project root. 0 when there is no usable history. */
export function commitCount(root) {
  const out = git(root, ["rev-list", "--count", "HEAD", "--", "."]);
  return out === null ? 0 : Number(out) || 0;
}

export function head(root) {
  return git(root, ["rev-parse", "--short=12", "HEAD"]);
}

/** Uncommitted paths under the project root, excluding relay's own files. */
export function dirtyFiles(root) {
  const out = git(root, ["status", "--porcelain", ...WORK]);
  if (!out) return [];
  return out.split("\n").map((l) => l.slice(3)).filter(Boolean);
}

/**
 * Commits of real work since `rev`. `null` when `rev` is unknown to this
 * repository — history rewritten, or a log copied from another clone.
 */
export function commitsSince(root, rev) {
  if (!rev || git(root, ["cat-file", "-e", `${rev}^{commit}`]) === null) return null;
  const out = git(root, ["rev-list", "--count", `${rev}..HEAD`, ...WORK]);
  return out === null ? null : Number(out) || 0;
}

/**
 * The commit from which `rels` can be restored exactly, or null. True only when
 * every file is tracked and has no uncommitted changes — then HEAD holds them.
 */
export function recoverableFrom(root, rels) {
  if (!rels.length || !isGitRepo(root)) return null;
  if (git(root, ["ls-files", "--error-unmatch", "--", ...rels]) === null) return null;
  if (git(root, ["status", "--porcelain", "--", ...rels])) return null;
  return head(root);
}

/** The newest commit that changed `rel`, or null if it was never committed. */
export function lastCommitTouching(root, rel) {
  return git(root, ["log", "-1", "--format=%H", "--", rel]) || null;
}

/** What `relay init` records about an existing repository in the bootstrap entry. */
export function gitFacts(root, { recent = 20, hotWindow = 500, hot = 10 } = {}) {
  const commits = commitCount(root);
  if (!commits) return null;

  const lines = (out) => (out ? out.split("\n").filter(Boolean) : []);
  const first = git(root, ["log", "--reverse", "--format=%ad", "--date=short", "--", "."]);
  const last = git(root, ["log", "-1", "--format=%ad", "--date=short", "--", "."]);

  const churn = new Map();
  for (const file of lines(git(root, ["log", `-${hotWindow}`, "--name-only", "--format=", ...WORK]))) {
    churn.set(file, (churn.get(file) || 0) + 1);
  }

  return {
    commits,
    branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    head: head(root),
    firstDate: first ? first.split("\n")[0] : null,
    lastDate: last,
    contributors: lines(git(root, ["shortlog", "-sn", "HEAD", "--", "."])).map((l) => {
      const [, n, name] = /^\s*(\d+)\s+(.*)$/.exec(l) || [];
      return { name, commits: Number(n) };
    }),
    recent: lines(
      git(root, ["log", `-${recent}`, "--format=%h %ad %an — %s", "--date=short", "--", "."]),
    ),
    hotFiles: [...churn.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, hot)
      .map(([file, count]) => ({ file, count })),
    tags: lines(git(root, ["tag", "--sort=-creatordate"])).slice(0, 10),
    dirty: dirtyFiles(root).length,
  };
}
