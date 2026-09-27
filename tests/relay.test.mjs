import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  addHours,
  historyFilename,
  parseFrontmatter,
  parseHistoryFilename,
  serializeFrontmatter,
  slugify,
} from "../skills/engineering/relay/src/core.mjs";
import { BLOCK_START, runInit } from "../skills/engineering/relay/src/init.mjs";
import { detectMode } from "../skills/engineering/relay/src/adopt.mjs";
import {
  bootstrapPending,
  commitDrift,
  createLog,
  indexIsCurrent,
  writeIndex,
} from "../skills/engineering/relay/src/history.mjs";
import {
  claim,
  isExpired,
  leftoverWork,
  nextUnblocked,
  readTasks,
  renewIfHeld,
  updateTask,
} from "../skills/engineering/relay/src/tasks.mjs";
import { readHistory } from "../skills/engineering/relay/src/core.mjs";
import { runDoctor } from "../skills/engineering/relay/src/doctor.mjs";
import { planMigration } from "../skills/engineering/relay/src/migrate.mjs";

const sandbox = () => fs.mkdtempSync(path.join(os.tmpdir(), "relay-test-"));

function project() {
  const root = sandbox();
  runInit(root, { harnesses: ["generic"] });
  return root;
}

const git = (root, ...args) =>
  execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, stdio: "pipe" },
  );

/** A repository with `n` commits of real code. */
function repo(n = 2) {
  const root = sandbox();
  git(root, "init", "-q", "-b", "main");
  for (let i = 0; i < n; i += 1) {
    fs.writeFileSync(path.join(root, "app.js"), `// ${i}\n`);
    git(root, "add", "-A");
    git(root, "commit", "-qm", `commit ${i}`);
  }
  return root;
}

const commitAll = (root, msg) => {
  git(root, "add", "-A");
  git(root, "commit", "-qm", msg);
};

/* ------------------------------------------------------------------ core */

test("frontmatter round-trips scalars and arrays", () => {
  const data = { seq: 3, agent: "claude", supersedes: [1, 2], summary: "a: b, c" };
  const { data: back } = parseFrontmatter(`${serializeFrontmatter(data)}\n\nbody`);
  assert.deepEqual(back, data);
});

test("frontmatter keeps the body intact", () => {
  const { body } = parseFrontmatter("---\na: 1\n---\n\n# Title\n\ntext\n");
  assert.equal(body, "# Title\n\ntext\n");
});

test("history filenames encode global order", () => {
  assert.equal(historyFilename(7, "claude", "staging deploy"), "0007_claude_staging-deploy.md");
  const parsed = parseHistoryFilename("0007_claude_staging-deploy.md");
  assert.deepEqual(
    { seq: parsed.seq, agent: parsed.agent, task: parsed.task },
    { seq: 7, agent: "claude", task: "staging-deploy" },
  );
  // The reason the scheme exists: lexical sort equals chronological sort.
  const names = [historyFilename(2, "warp", "b"), historyFilename(10, "cursor", "c"), historyFilename(1, "a", "a")];
  assert.deepEqual([...names].sort(), [names[2], names[0], names[1]]);
});

test("slugify is bounded and url-safe", () => {
  assert.equal(slugify("Fix the OAuth  redirect_URI!"), "fix-the-oauth-redirect-uri");
  assert.ok(slugify("x".repeat(200)).length <= 48);
});

/* ------------------------------------------------------------------ init */

test("init scaffolds the directory and does not clobber on re-run", () => {
  const root = project();
  for (const f of ["PROJECT.md", "tasks.md", "history.md", "config.json"]) {
    assert.ok(fs.existsSync(path.join(root, ".relay", f)), `${f} missing`);
  }
  fs.writeFileSync(path.join(root, ".relay", "PROJECT.md"), "MINE");
  runInit(root, { harnesses: ["generic"] });
  assert.equal(fs.readFileSync(path.join(root, ".relay", "PROJECT.md"), "utf8"), "MINE");
});

/* ----------------------------------------------------------------- tasks */

test("the format example in tasks.md is not parsed as real tasks", () => {
  const root = project();
  const slugs = readTasks(root).map((t) => t.slug);
  assert.deepEqual(slugs, ["first-task"]);
});

test("claiming sets an expiry and refuses to steal a live claim", () => {
  const root = project();
  const t = claim(root, "first-task", "claude", 4);
  assert.equal(t.agent, "claude");
  assert.ok(t.expiresAt);
  assert.throws(() => claim(root, "first-task", "cursor", 4), /claimed by claude/);
});

test("an expired claim is takeable", () => {
  const root = project();
  claim(root, "first-task", "claude", 4);
  updateTask(root, "first-task", (t) => {
    t.expiresAt = addHours(new Date().toISOString(), -1);
  });
  const [task] = readTasks(root);
  assert.equal(isExpired(task), true);
  assert.equal(nextUnblocked(root).slug, "first-task");
});

/* --------------------------------------------------------------- history */

test("the index is derived from the log files", () => {
  const root = project();
  createLog(root, { agent: "claude", task: "first-task", summary: "did a thing", next: "do the next thing" });
  writeIndex(root);
  const index = fs.readFileSync(path.join(root, ".relay", "history.md"), "utf8");
  assert.match(index, /did a thing/);
  assert.match(index, /0001_claude_first-task\.md/);
  assert.equal(indexIsCurrent(root), true);
});

test("a hand-edited index is detected as stale", () => {
  const root = project();
  createLog(root, { agent: "claude", task: "first-task", summary: "s", next: "n" });
  writeIndex(root);
  fs.appendFileSync(path.join(root, ".relay", "history.md"), "\nhand edited\n");
  assert.equal(indexIsCurrent(root), false);
});

test("sequences increment across different agents", () => {
  const root = project();
  createLog(root, { agent: "cursor", task: "a", summary: "s", next: "n" });
  const second = createLog(root, { agent: "warp", task: "b", summary: "s", next: "n" });
  assert.equal(second.seq, 2);
  assert.equal(second.file, "0002_warp_b.md");
});

/* ---------------------------------------------------------------- doctor */

test("doctor passes on a complete project", () => {
  const root = project();
  createLog(root, { agent: "claude", task: "first-task", summary: "s", next: "n" });
  writeIndex(root);
  const res = runDoctor(root);
  assert.equal(res.counts.error, 0, JSON.stringify(res.findings, null, 2));
});

test("doctor flags unfilled placeholders", () => {
  const root = project();
  createLog(root, { agent: "claude", task: "first-task" });
  writeIndex(root);
  const codes = runDoctor(root).findings.map((f) => f.code);
  assert.ok(codes.includes("placeholder-left"));
});

test("doctor flags unreadable logs and expired claims", () => {
  const root = project();
  fs.writeFileSync(path.join(root, ".relay", "history", "notes.md"), "x");
  claim(root, "first-task", "claude", 4);
  updateTask(root, "first-task", (t) => {
    t.expiresAt = addHours(new Date().toISOString(), -1);
  });
  const codes = runDoctor(root).findings.map((f) => f.code);
  assert.ok(codes.includes("unreadable-log"));
  assert.ok(codes.includes("claim-expired"));
});

test("doctor flags credential-shaped strings but not placeholders", () => {
  const root = project();
  const dir = path.join(root, ".relay", "history");
  fs.writeFileSync(path.join(dir, "0001_a_b.md"), "---\nseq: 1\n---\npostgres://u:realpw@host/db\n");
  assert.ok(runDoctor(root).findings.some((f) => f.code === "possible-secret"));

  const clean = project();
  fs.writeFileSync(
    path.join(clean, ".relay", "history", "0001_a_b.md"),
    "---\nseq: 1\n---\npostgres://user:pass@host/db\n",
  );
  assert.ok(!runDoctor(clean).findings.some((f) => f.code === "possible-secret"));
});

/* --------------------------------------------------------------- migrate */

test("migration recovers global order from a legacy index", () => {
  const root = sandbox();
  fs.writeFileSync(path.join(root, "history_cursor_01.md"), "# first\nwork by cursor here\n");
  fs.writeFileSync(path.join(root, "history_warp_01.md"), "# second\nwork by warp here\n");
  fs.writeFileSync(path.join(root, "history_cursor_02.md"), "# third\nwork by cursor again\n");
  fs.writeFileSync(
    path.join(root, "history.md"),
    [
      "| 2026-01-01 | Cursor | [history_cursor_01.md](history_cursor_01.md) | one |",
      "| 2026-01-02 | Warp | [history_warp_01.md](history_warp_01.md) | two |",
      "| 2026-01-03 | Cursor | [history_cursor_02.md](history_cursor_02.md) | three |",
    ].join("\n"),
  );

  const plan = planMigration(root, { from: "." });
  // Interleaved across agents — order the legacy per-agent names cannot express.
  assert.deepEqual(
    plan.records.map((r) => r.file),
    ["history_cursor_01.md", "history_warp_01.md", "history_cursor_02.md"],
  );
  assert.deepEqual(plan.records.map((r) => r.seq), [1, 2, 3]);
  assert.equal(plan.unindexed, 0);
});

test("migration flags files that were missing from the legacy index", () => {
  const root = sandbox();
  fs.writeFileSync(path.join(root, "history_cursor_01.md"), "# a\ncontent here\n");
  fs.writeFileSync(path.join(root, "history_kiro_01.md"), "# b\ncontent here\n");
  fs.writeFileSync(
    path.join(root, "history.md"),
    "| 2026-01-01 | Cursor | [history_cursor_01.md](history_cursor_01.md) | one |",
  );
  const plan = planMigration(root, { from: "." });
  assert.equal(plan.unindexed, 1);
});

/* ---------------------------------------------------- claims: heartbeat */

test("re-claiming your own live claim renews it instead of refusing", () => {
  const root = project();
  claim(root, "first-task", "claude", 1);
  updateTask(root, "first-task", (t) => {
    t.expiresAt = addHours(new Date().toISOString(), 0.1);
  });
  const renewed = claim(root, "first-task", "claude", 1);
  assert.equal(renewed.renewed, true);
  const [task] = readTasks(root);
  assert.ok(task.seenAt, "renewal records when the holder was last seen");
  assert.ok(Date.parse(task.expiresAt) > Date.now() + 50 * 60 * 1000);
});

test("the seen field survives a round-trip through tasks.md", () => {
  const root = project();
  claim(root, "first-task", "claude", 1);
  claim(root, "first-task", "claude", 1);
  const [task] = readTasks(root);
  assert.match(task.raw, / — seen \d{4}-/);
  assert.equal(task.agent, "claude");
});

test("renewIfHeld renews only the holder's own live claim", () => {
  const root = project();
  claim(root, "first-task", "claude", 1);
  assert.equal(renewIfHeld(root, "first-task", "cursor", 1), false);
  assert.equal(renewIfHeld(root, "first-task", "claude", 1), true);
  assert.equal(renewIfHeld(root, "no-such-task", "claude", 1), false);
});

test("a live claim is refused with evidence for the user", () => {
  const root = project();
  claim(root, "first-task", "claude", 1);
  assert.throws(
    () => claim(root, "first-task", "cursor", 1),
    (err) =>
      /last active/.test(err.message) &&
      /files modified since the claim/.test(err.message) &&
      /--force/.test(err.message),
  );
});

test("without git, leftover work is the files modified since the claim", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "old.js"), "1");
  const past = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(path.join(root, "old.js"), past, past);
  const t = claim(root, "first-task", "claude", 1);
  fs.writeFileSync(path.join(root, "half-done.js"), "2");
  const work = leftoverWork(root, t.claimedAt);
  assert.equal(work.git, false);
  assert.ok(work.files.includes("half-done.js"));
  assert.ok(!work.files.includes("old.js"));
  assert.ok(!work.files.some((f) => f.startsWith(".relay")), "relay's own files are not leftover work");
});

test("with git, leftover work is the uncommitted changes", () => {
  const root = repo(2);
  runInit(root, {});
  commitAll(root, "adopt relay");
  fs.writeFileSync(path.join(root, "app.js"), "// half done\n");
  const work = leftoverWork(root, new Date().toISOString());
  assert.equal(work.git, true);
  assert.deepEqual(work.files, ["app.js"]);
});

test("force takes over a live claim and reports who held it", () => {
  const root = project();
  claim(root, "first-task", "claude", 1);
  const t = claim(root, "first-task", "cursor", 1, { force: true });
  assert.equal(t.agent, "cursor");
  assert.equal(t.takenOverFrom.agent, "claude");
});

test("force never reopens a DONE task", () => {
  const root = project();
  createLog(root, { agent: "claude", task: "first-task", summary: "s", next: "n" });
  updateTask(root, "first-task", (t) => {
    t.state = "DONE";
    t.log = "0001";
  });
  assert.throws(() => claim(root, "first-task", "cursor", 1, { force: true }), /already DONE/);
});

/* ------------------------------------------------------- init: detection */

test("an empty directory, or one with only README and LICENSE, is a new project", () => {
  const root = sandbox();
  assert.equal(detectMode(root), "new");
  fs.writeFileSync(path.join(root, "README.md"), "# x");
  fs.writeFileSync(path.join(root, "LICENSE"), "MIT");
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules");
  assert.equal(detectMode(root), "new");
});

test("code without git history is detected as code mode", () => {
  const root = sandbox();
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "index.js"), "1");
  assert.equal(detectMode(root), "code");
});

test("a single-commit repository counts as code, not git history", () => {
  assert.equal(detectMode(repo(1)), "code");
});

test("a repository with real history is detected as git mode", () => {
  assert.equal(detectMode(repo(3)), "git");
});

test("dependencies and build output do not make a project look existing", () => {
  const root = sandbox();
  fs.mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "x", "index.js"), "1");
  assert.equal(detectMode(root), "new");
});

/* ---------------------------------------------------- init: shared files */

test("init adds a marked block to an existing AGENTS.md and keeps the user's content", () => {
  const root = sandbox();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Mine\n\nUse pnpm.\n");
  const res = runInit(root, { harnesses: ["codex"] });
  const text = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  assert.ok(text.startsWith("# Mine\n\nUse pnpm.\n"));
  assert.ok(text.includes(BLOCK_START));
  assert.ok(text.includes(".relay/"));
  assert.deepEqual(res.updated, ["AGENTS.md"]);
});

test("re-running init replaces the block instead of duplicating it", () => {
  const root = sandbox();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Mine\n");
  runInit(root, { harnesses: ["codex"] });
  runInit(root, { harnesses: ["codex"] });
  const text = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  assert.equal(text.split(BLOCK_START).length - 1, 1);
});

test("relay-owned files are still left alone without --force", () => {
  const root = sandbox();
  fs.mkdirSync(path.join(root, ".cursor", "rules"), { recursive: true });
  fs.writeFileSync(path.join(root, ".cursor", "rules", "relay.mdc"), "MINE");
  runInit(root, { harnesses: ["cursor"] });
  assert.equal(fs.readFileSync(path.join(root, ".cursor", "rules", "relay.mdc"), "utf8"), "MINE");
});

/* ------------------------------------------------------ init: bootstrap */

test("new projects get no bootstrap entry", () => {
  const res = runInit(sandbox(), {});
  assert.equal(res.mode, "new");
  assert.equal(res.bootstrap, null);
});

test("git mode writes a bootstrap entry built from the log, which doctor rejects until finished", () => {
  const root = repo(3);
  const res = runInit(root, {});
  assert.equal(res.mode, "git");
  const text = fs.readFileSync(path.join(root, res.bootstrap), "utf8");
  assert.match(text, /bootstrap: git/);
  assert.match(text, /3 commits/);
  assert.match(text, /commit 2/);
  assert.ok(bootstrapPending(readHistory(root)));
  const codes = runDoctor(root).findings.map((f) => f.code);
  assert.ok(codes.includes("bootstrap-incomplete"));
  assert.ok(!codes.includes("placeholder-left"), "one clear error, not two");
});

test("code mode writes a bootstrap entry from the working tree and says dates are a guess", () => {
  const root = sandbox();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "legacy", scripts: { start: "x" } }));
  fs.writeFileSync(path.join(root, "server.js"), "1");
  const res = runInit(root, {});
  assert.equal(res.mode, "code");
  const text = fs.readFileSync(path.join(root, res.bootstrap), "utf8");
  assert.match(text, /bootstrap: code/);
  assert.match(text, /no usable git history/);
  assert.match(text, /scripts: start/);
});

test("a finished bootstrap entry passes doctor", () => {
  const root = repo(2);
  const res = runInit(root, {});
  const file = path.join(root, res.bootstrap);
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, "utf8")
      .replace(/^summary: .*$/m, "summary: A shop; checkout works, payments deferred.")
      .replace(/^next: .*$/m, "next: Build the cart page.")
      .replace(/^status: partial$/m, "status: done"),
  );
  writeIndex(root);
  assert.equal(bootstrapPending(readHistory(root)), null);
  assert.equal(runDoctor(root).counts.error, 0, JSON.stringify(runDoctor(root).findings));
});

test("legacy history files suppress the bootstrap in favour of migration", () => {
  const root = sandbox();
  fs.writeFileSync(path.join(root, "app.js"), "1");
  fs.writeFileSync(path.join(root, "history_cursor_01.md"), "# old");
  const res = runInit(root, {});
  assert.equal(res.legacy, ".");
  assert.equal(res.bootstrap, null);
});

test("re-running init never adds a bootstrap to a project that was set up earlier", () => {
  const root = sandbox();
  runInit(root, {});
  fs.writeFileSync(path.join(root, "app.js"), "1");
  const res = runInit(root, { harnesses: ["zed"] });
  assert.equal(res.bootstrap, null);
  assert.equal(readHistory(root).length, 0);
});

test("--mode forces a bootstrap onto a project adopted with an older relay", () => {
  const root = sandbox();
  runInit(root, {});
  fs.writeFileSync(path.join(root, "app.js"), "1");
  const res = runInit(root, { mode: "code" });
  assert.ok(res.bootstrap);
});

test("--mode git is refused without git history", () => {
  assert.throws(() => runInit(sandbox(), { mode: "git" }), /at least two commits/);
  assert.throws(() => runInit(sandbox(), { mode: "nope" }), /--mode must be one of/);
});

/* ----------------------------------------------------------------- drift */

test("drift is off without git", () => {
  assert.deepEqual(commitDrift(project()), { git: false, count: null });
});

test("commits after the last committed log are counted; relay bookkeeping is not", () => {
  const root = repo(2);
  runInit(root, {});
  commitAll(root, "adopt relay");
  assert.equal(commitDrift(root).count, 0);

  fs.writeFileSync(path.join(root, "app.js"), "// work\n");
  commitAll(root, "work 1");
  fs.appendFileSync(path.join(root, ".relay", "tasks.md"), "\n");
  commitAll(root, "only relay bookkeeping");
  assert.equal(commitDrift(root).count, 1);

  createLog(root, { agent: "claude", task: "t", summary: "s", next: "n" });
  commitAll(root, "log it");
  assert.equal(commitDrift(root).count, 0);
});

test("logs record git_head, which is the fallback when .relay is never committed", () => {
  const root = repo(2);
  runInit(root, { mode: "new" });
  const { path: logPath } = createLog(root, { agent: "claude", task: "t", summary: "s", next: "n" });
  assert.match(fs.readFileSync(logPath, "utf8"), /^git_head: \S+$/m);
  fs.writeFileSync(path.join(root, ".gitignore"), ".relay/\n");
  fs.writeFileSync(path.join(root, "app.js"), "// more\n");
  commitAll(root, "work without relay committed");
  const drift = commitDrift(root);
  assert.equal(drift.count, 1);
  assert.match(drift.since, /0001_claude_t\.md/);
});

test("doctor warns about unlogged commits past the configured threshold", () => {
  const root = repo(2);
  runInit(root, {});
  commitAll(root, "adopt relay");
  const cfg = path.join(root, ".relay", "config.json");
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, "utf8")), unloggedCommitsWarn: 2 }));
  commitAll(root, "config");
  for (const i of [1, 2]) {
    fs.writeFileSync(path.join(root, "app.js"), `// unlogged work ${i}\n`);
    commitAll(root, `work ${i}`);
  }
  assert.ok(runDoctor(root).findings.some((f) => f.code === "unlogged-commits"));
});
