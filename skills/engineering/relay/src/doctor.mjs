/**
 * `relay doctor` — the check that makes the protocol self-enforcing.
 *
 * Every rule here exists because it failed in a real project. A protocol that
 * relies on agents remembering to do things degrades the moment one of them
 * runs out of credits mid-task. A protocol that can be verified in one command
 * degrades visibly, which is the only kind of degradation you can fix.
 */
import fs from "node:fs";
import path from "node:path";
import {
  paths,
  read,
  readConfig,
  readHistory,
  readHistoryOrphans,
} from "./core.mjs";
import { commitDrift, indexIsCurrent } from "./history.mjs";
import { sectionText } from "./compact.mjs";
import { isExpired, readTasks } from "./tasks.mjs";
import { REQUIRED_FIELDS } from "./history.mjs";

// Credential shapes worth refusing to publish. Deliberately narrow: this is a
// last-resort net, not a secret scanner. Placeholders are excluded so the
// check stays quiet on documentation.
const SECRET_PATTERNS = [
  [/postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`@]+@/i, "database URL with password"],
  [/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/, "private key"],
  [/\bAIza[0-9A-Za-z_-]{30,}/, "Google API key"],
  [/\bGOCSPX-[0-9A-Za-z_-]{20,}/, "Google OAuth client secret"],
  [/\bgh[pousr]_[0-9A-Za-z]{30,}/, "GitHub token"],
  [/\bsk-[A-Za-z0-9]{32,}/, "API secret key"],
  [/\bxox[baprs]-[0-9A-Za-z-]{10,}/, "Slack token"],
];
const PLACEHOLDER = /user:pass@|<redacted>|example\.com|YOUR_|xxxx/i;

export function runDoctor(root, { strict = false } = {}) {
  const findings = [];
  const add = (level, code, message, hint) =>
    findings.push({ level, code, message, hint });

  const p = paths(root);
  const config = readConfig(root);

  /* 1 — structure */
  for (const [label, file] of [
    ["tasks.md", p.tasks],
    ["PROJECT.md", p.project],
  ]) {
    if (!fs.existsSync(file)) {
      add("error", "missing-file", `${DIRLABEL}/${label} is missing.`, "Run `relay init`.");
    }
  }
  if (!fs.existsSync(p.historyDir)) {
    add("warn", "no-history-dir", `${DIRLABEL}/history/ does not exist yet.`, "It is created by `relay log`.");
  }

  const entries = readHistory(root);
  const tasks = readTasks(root);

  /* 1b — the templates were actually filled in */
  const project = read(p.project);
  if (project !== null && !sectionText(project, "What this project is")) {
    add(
      "warn",
      "project-unfilled",
      "PROJECT.md is still the template — \"What this project is\" is empty.",
      "Fill it in with the user: see docs/setup.md in the relay skill.",
    );
  }
  if (tasks.some((t) => t.slug === "first-task")) {
    add(
      "warn",
      "placeholder-task",
      "tasks.md still has the template task `first-task`.",
      "Replace it with the real work, in priority order.",
    );
  }

  /* 2 — generated index matches the files it is derived from */
  if (fs.existsSync(p.historyDir)) {
    if (!indexIsCurrent(root)) {
      add(
        "error",
        "index-stale",
        "history.md does not match .relay/history/.",
        "Run `relay index`. Never edit history.md by hand.",
      );
    }
  }

  /* 3 — files relay cannot read are invisible to every future agent */
  for (const orphan of readHistoryOrphans(root)) {
    add(
      "error",
      "unreadable-log",
      `history/${orphan} does not match NNNN_agent_task.md and is excluded from the index.`,
      "Rename it to NNNN_agent_task.md, continuing the sequence.",
    );
  }

  /* 4 — sequence integrity */
  const seen = new Map();
  for (const e of entries) {
    if (seen.has(e.seq)) {
      add(
        "error",
        "duplicate-seq",
        `Sequence ${e.seq} used twice: ${seen.get(e.seq)} and ${e.file}.`,
        "Two agents logged concurrently. Renumber the later one to the next free sequence.",
      );
    }
    seen.set(e.seq, e.file);
  }
  for (let i = 1; i < entries.length; i += 1) {
    const gap = entries[i].seq - entries[i - 1].seq;
    if (gap > 1) {
      add(
        "warn",
        "seq-gap",
        `Gap between ${entries[i - 1].file} and ${entries[i].file} (${gap - 1} missing).`,
        "Usually a deleted log. Harmless, but confirm nothing was lost.",
      );
    }
  }

  /* 5/6 — front-matter completeness and unedited templates */
  for (const e of entries) {
    const missing = REQUIRED_FIELDS.filter(
      (f) => e.data[f] === undefined || e.data[f] === "",
    );
    if (missing.length) {
      add(
        "error",
        "incomplete-frontmatter",
        `history/${e.file} is missing: ${missing.join(", ")}.`,
        "The index is derived from these fields; blanks make the entry useless to the next agent.",
      );
    }
    for (const field of ["summary", "next"]) {
      if (typeof e.data[field] === "string" && e.data[field].startsWith("TODO:")) {
        if (e.data.bootstrap) {
          add(
            "error",
            "bootstrap-incomplete",
            `history/${e.file} — relay was adopted but setup was never finished (\`${field}\` is a placeholder).`,
            "An agent must complete adoption: see docs/setup.md in the relay skill.",
          );
          break;
        }
        if (e.data.compact) {
          add(
            "error",
            "compact-incomplete",
            `history/${e.file} — a compaction was started but not finished (\`${field}\` is a placeholder).`,
            "Complete the summary with the user, then run `relay compact --finish`. Or delete the draft.",
          );
          break;
        }
        add(
          "error",
          "placeholder-left",
          `history/${e.file} still has the template \`${field}\`.`,
          "A log without a real `next:` costs the following agent a full context rebuild.",
        );
      }
    }
    if (e.data.seq !== undefined && e.data.seq !== e.seq) {
      add(
        "error",
        "seq-mismatch",
        `history/${e.file} has front-matter seq ${e.data.seq} but filename seq ${e.seq}.`,
        "Filename wins for ordering; fix the front-matter.",
      );
    }
  }

  /* 7 — claims that outlived their agent */
  for (const t of tasks) {
    if (t.state === "IN_PROGRESS") {
      if (!t.expiresAt) {
        add(
          "warn",
          "claim-no-ttl",
          `\`${t.slug}\` is claimed by ${t.agent} with no expiry.`,
          "Re-claim with `relay claim` so it carries a TTL.",
        );
      } else if (isExpired(t)) {
        add(
          "error",
          "claim-expired",
          `\`${t.slug}\` claimed by ${t.agent} at ${t.claimedAt} expired at ${t.expiresAt}.`,
          "That agent is almost certainly gone. Take it over with `relay claim --force` and note the takeover.",
        );
      }
    }
  }

  /* 8 — DONE tasks must point at a log that exists */
  const bySeq = new Set(entries.map((e) => e.seq));
  for (const t of tasks) {
    if (t.state !== "DONE") continue;
    if (!t.log) {
      add("warn", "done-no-log", `\`${t.slug}\` is DONE but cites no log.`, "Use `relay done <task> --log <seq>`.");
      continue;
    }
    const n = Number(String(t.log).replace(/\D/g, ""));
    if (!bySeq.has(n)) {
      add(
        "error",
        "done-bad-log",
        `\`${t.slug}\` is DONE and cites log ${t.log}, which does not exist.`,
        "Point it at a real sequence number.",
      );
    }
  }

  /* 9 — competing trackers with no declared precedence */
  for (const alias of config.trackerAliases) {
    const candidate = path.join(root, alias);
    if (fs.existsSync(candidate)) {
      add(
        "warn",
        "competing-tracker",
        `${alias} exists at the project root alongside .relay/tasks.md.`,
        "Either delete it or note in PROJECT.md that tasks.md takes precedence.",
      );
    }
  }

  /* 10 — work that landed in git with no handoff log explaining it */
  const drift = commitDrift(root);
  if (drift.count && drift.count >= config.unloggedCommitsWarn) {
    add(
      "warn",
      "unlogged-commits",
      `${drift.count} commits since ${drift.since} with no handoff log.`,
      "Someone worked without logging. Write a log that explains what those commits did and what comes next.",
    );
  }

  /* 11 — secrets, because history files get published */
  if (fs.existsSync(p.dir)) {
    for (const file of walk(p.dir)) {
      const text = read(file);
      if (text === null) continue;
      for (const [re, label] of SECRET_PATTERNS) {
        const m = re.exec(text);
        if (m && !PLACEHOLDER.test(m[0])) {
          add(
            "error",
            "possible-secret",
            `${path.relative(root, file)} contains something shaped like a ${label}.`,
            "Redact it. History files are meant to be readable by every future agent, and often end up in git.",
          );
          break;
        }
      }
    }
  }

  const errors = findings.filter((f) => f.level === "error");
  const warns = findings.filter((f) => f.level === "warn");
  return {
    findings,
    ok: errors.length === 0 && (!strict || warns.length === 0),
    counts: { error: errors.length, warn: warns.length },
    stats: { entries: entries.length, tasks: tasks.length },
  };
}

const DIRLABEL = ".relay";

function* walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (st.isFile()) yield full;
  }
}
