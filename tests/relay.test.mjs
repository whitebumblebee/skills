import { test } from "node:test";
import assert from "node:assert/strict";
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
import { runInit } from "../skills/engineering/relay/src/init.mjs";
import { createLog, indexIsCurrent, writeIndex } from "../skills/engineering/relay/src/history.mjs";
import { claim, isExpired, nextUnblocked, readTasks, updateTask } from "../skills/engineering/relay/src/tasks.mjs";
import { runDoctor } from "../skills/engineering/relay/src/doctor.mjs";
import { planMigration } from "../skills/engineering/relay/src/migrate.mjs";

const sandbox = () => fs.mkdtempSync(path.join(os.tmpdir(), "relay-test-"));

function project() {
  const root = sandbox();
  runInit(root, { harnesses: ["generic"] });
  return root;
}

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
  assert.throws(() => claim(root, "first-task", "cursor", 4), /already claimed by claude/);
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
