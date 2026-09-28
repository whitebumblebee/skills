/**
 * Compaction: fold a finished round of work into one summary entry.
 *
 * A project collects one log per session. Once a round of tasks is finished,
 * those logs have done their job; what the next round needs is a summary. So:
 *
 *   relay compact           writes a draft summary as the newest entry. The CLI
 *                           fills in what it can collect (the range of logs,
 *                           agents, every log's summary and next, tasks done,
 *                           git range); the narrative is left as placeholders
 *                           for an agent to write with the user.
 *   relay compact --finish  once the draft is complete: deletes the round's
 *                           logs, makes the summary entry 0001, removes DONE
 *                           tasks, and regenerates the index. The next log is
 *                           0002.
 *
 * The summary is shaped like the adoption bootstrap entry on purpose: the
 * summary of one round is the starting point of the next.
 */
import fs from "node:fs";
import path from "node:path";
import {
  UserError,
  historyFilename,
  nowIso,
  parseFrontmatter,
  paths,
  readHistory,
  serializeFrontmatter,
  write,
} from "./core.mjs";
import { head, isGitRepo, recoverableFrom } from "./git.mjs";
import { writeIndex } from "./history.mjs";
import { isExpired, readTasks, removeDone } from "./tasks.mjs";

const isPlaceholder = (v) => typeof v === "string" && v.startsWith("TODO:");

/**
 * The draft awaiting completion, if any. A finished summary is always 0001;
 * a draft never is, because there must be something before it to compact.
 */
export function compactDraft(entries) {
  return entries.find((e) => e.data.compact && e.seq !== 1) || null;
}

/** The section of a markdown body under `heading`, without HTML comments. */
export function sectionText(body, heading) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return "";
  const out = [];
  for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i += 1) out.push(lines[i]);
  return out.join("\n").replace(/<!--[\s\S]*?-->/g, "").trim();
}

export function startCompact(root, { projectName } = {}) {
  const entries = readHistory(root);
  const existing = compactDraft(entries);
  if (existing) {
    throw new UserError(
      `A compaction draft already exists: history/${existing.file}.\n` +
        "Complete it and run `relay compact --finish`, or delete it to start over.",
    );
  }
  const round = entries.filter((e) => !(e.data.compact && e.seq === 1));
  if (!round.length) throw new UserError("Nothing to compact — no history since the last compaction.");

  const unfinished = entries.filter((e) => isPlaceholder(e.data.summary) || isPlaceholder(e.data.next));
  if (unfinished.length) {
    throw new UserError(
      `Finish these logs before compacting — their summary or next is still a placeholder:\n` +
        unfinished.map((e) => `  history/${e.file}`).join("\n"),
    );
  }

  const tasks = readTasks(root);
  const live = tasks.filter((t) => t.state === "IN_PROGRESS" && !isExpired(t));
  if (live.length) {
    throw new UserError(
      `Cannot compact while work is claimed:\n` +
        live.map((t) => `  \`${t.slug}\` — ${t.agent}`).join("\n") +
        "\nWait for those agents to log and finish, or ask the user.",
    );
  }

  const previous = entries.find((e) => e.data.compact && e.seq === 1);
  const roundNo = previous ? Number(previous.data.round || 1) + 1 : 1;
  const seq = entries[entries.length - 1].seq + 1;
  const file = historyFilename(seq, "relay", "compact");
  const front = serializeFrontmatter({
    seq,
    agent: "relay",
    date: nowIso(),
    task: "compact",
    status: "partial",
    summary: "TODO: one line — what exists now, after this round of work.",
    next: "TODO: the first thing the next round should do, agreed with the user.",
    supersedes: [],
    compact: true,
    round: roundNo,
    logs: round.length,
    period: `${String(round[0].data.date || "").slice(0, 10)} to ${String(round[round.length - 1].data.date || "").slice(0, 10)}`,
    git_head: head(root) || undefined,
  });
  const name = projectName || path.basename(root);
  write(
    path.join(paths(root).historyDir, file),
    `${front}\n\n${body(name, roundNo, round, tasks, previous)}`,
  );
  writeIndex(root);
  return { file, seq, covers: round.length };
}

function body(name, roundNo, round, tasks, previous) {
  const first = round[0];
  const last = round[round.length - 1];
  const day = (e) => String(e.data.date || "").slice(0, 10) || "?";
  const byAgent = new Map();
  for (const e of round) {
    const a = e.data.agent || e.agent;
    byAgent.set(a, (byAgent.get(a) || 0) + 1);
  }
  const done = tasks.filter((t) => t.state === "DONE");
  const open = tasks.filter((t) => t.state !== "DONE");
  const cell = (s) => String(s || "—").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const pad = (n) => String(n).padStart(4, "0");

  return [
    `# ${name} — round ${roundNo}`,
    "",
    "<!-- Written by `relay compact`. It will replace every log it covers.",
    '     Every future agent reads "What is true now", so keep that section short.',
    "     The other sections are the record, read only when needed.",
    "     Move anything that stays true — rules, constraints, decisions that",
    "     govern future work — into PROJECT.md, and list it under",
    '     "Moved to PROJECT.md". Then run `relay compact --finish`. -->',
    "",
    "## What is true now",
    "",
    "<!-- 5–15 lines: what exists and works, what is deployed where, what is fragile. -->",
    "",
    "## What was built",
    "",
    "<!-- The work of this round, grouped by feature or area rather than by session. -->",
    "",
    "## Decisions and why",
    "",
    "<!-- Choices a later agent might otherwise undo, with the reason for each. -->",
    "",
    "## Still open or risky",
    "",
    "<!-- Known bugs, shortcuts, unverified assumptions, deferred work. -->",
    "",
    "## Moved to PROJECT.md",
    "",
    "<!-- The lasting rules you promoted, or \"nothing\". -->",
    "",
    "## Facts collected at compaction",
    "",
    `- Logs covered: ${pad(first.seq)}–${pad(last.seq)} (${round.length}), ${day(first)} to ${day(last)}`,
    `- Agents: ${[...byAgent.entries()].map(([a, n]) => `${a} (${n})`).join(", ")}`,
    `- Tasks done: ${done.length ? done.map((t) => `\`${t.slug}\``).join(", ") : "none"}`,
    `- Carried over to the next round: ${open.length ? open.map((t) => `\`${t.slug}\` (${t.state})`).join(", ") : "none"}`,
    ...(previous
      ? [
          `- Earlier rounds: summarised in \`${previous.file}\` (round ${previous.data.round || 1}), which this`,
          "  entry replaces. Carry forward whatever in it is still true.",
        ]
      : []),
    "",
    "### Every log in this round",
    "",
    "| Seq | Date | Agent | Task | Summary | Next |",
    "| --- | --- | --- | --- | --- | --- |",
    ...round.map(
      (e) =>
        `| ${pad(e.seq)} | ${day(e)} | ${cell(e.data.agent || e.agent)} | \`${cell(e.data.task || e.task)}\` | ${cell(e.data.summary)} | ${cell(e.data.next)} |`,
    ),
    "",
  ].join("\n");
}

export function finishCompact(root, { confirmDelete = false } = {}) {
  const entries = readHistory(root);
  const draft = compactDraft(entries);
  if (!draft) throw new UserError("No compaction draft. Start one with `relay compact`.");
  const later = entries.filter((e) => e.seq > draft.seq);
  if (later.length) {
    throw new UserError(
      `Logs were written after the draft (${later.map((e) => e.file).join(", ")}).\n` +
        "Delete the draft and run `relay compact` again so it covers them.",
    );
  }

  const text = fs.readFileSync(draft.path, "utf8");
  const { data, body: draftBody } = parseFrontmatter(text);
  const missing = [];
  if (isPlaceholder(data.summary)) missing.push("summary:");
  if (isPlaceholder(data.next)) missing.push("next:");
  if (!sectionText(draftBody, "What is true now")) missing.push('"What is true now"');
  if (missing.length) {
    throw new UserError(
      `history/${draft.file} is not finished — still empty: ${missing.join(", ")}.\n` +
        "Write them with the user, then run `relay compact --finish` again.",
    );
  }

  const covered = entries.filter((e) => e.seq < draft.seq);
  const rels = covered.map((e) => path.relative(root, e.path));
  const from = recoverableFrom(root, rels);
  if (!from && !confirmDelete) {
    throw new UserError(
      `Deleting ${covered.length} log(s) cannot be undone here — ` +
        (isGitRepo(root)
          ? "some are not committed, so git cannot restore them."
          : "there is no git repository to restore them from.") +
        "\nThe summary is all that will remain. Ask the user; if they agree, run:\n" +
        "  relay compact --finish --confirm-delete",
    );
  }

  for (const e of covered) fs.rmSync(e.path);
  const final = serializeFrontmatter({
    ...data,
    seq: 1,
    status: "done",
    recover_from: from || undefined,
  });
  fs.rmSync(draft.path);
  const target = path.join(paths(root).historyDir, historyFilename(1, "relay", "compact"));
  write(target, `${final}\n\n${draftBody}`);
  const removedTasks = removeDone(root);
  writeIndex(root);
  return { deleted: covered.length, recoverFrom: from, removedTasks, file: path.basename(target) };
}
